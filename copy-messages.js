
import {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits
} from 'discord.js';

import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.DISCORD_TOKEN;

const [SOURCE_ID, DEST_ID] = process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node copy-messages.js SOURCE_CHANNEL_ID DEST_CHANNEL_ID'
    );
    process.exit(1);
}

if (SOURCE_ID === DEST_ID) {
    throw new Error('Source and destination must differ.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const progressFile = path.resolve(
    `copy-progress-${SOURCE_ID}-${DEST_ID}.json`
);

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

async function readProgress() {
    try {
        return JSON.parse(
            await fs.readFile(progressFile, 'utf8')
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { lastMessageId: null, completed: false };
        }
        throw error;
    }
}

async function saveProgress(progress) {
    const tempFile = `${progressFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(progress, null, 2));
    await fs.rename(tempFile, progressFile);
}

async function getAllMessages(channel, lastId) {
    const messages = [];
    let before;

    console.log('Fetching source message history...');

    while (true) {
        const options = { limit: 100 };
        if (before) options.before = before;

        const batch = await channel.messages.fetch(options);

        if (!batch.size) break;

        const sorted = [...batch.values()]
            .sort((a, b) =>
                BigInt(a.id) < BigInt(b.id) ? -1 : 1
            );

        for (const message of sorted) {
            if (!lastId || BigInt(message.id) > BigInt(lastId)) {
                messages.push(message);
            }
        }

        before = sorted[0].id;

        console.log(`Fetched ${messages.length} messages...`);

        if (batch.size < 100) break;

        if (lastId && BigInt(before) <= BigInt(lastId)) {
            break;
        }
    }

    return messages.sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 : 1
    );
}

async function main() {
    try {
        await client.login(TOKEN);

        const source = await client.channels.fetch(SOURCE_ID);
        const destination = await client.channels.fetch(DEST_ID);

        if (
            !source ||
            !destination ||
            !source.guild ||
            !destination.guild ||
            !source.messages ||
            !destination.send ||
            !destination.createWebhook
        ) {
            throw new Error('Both IDs must be supported server text channels.');
        }

        const sourceBot = await source.guild.members.fetchMe();
        const destBot = await destination.guild.members.fetchMe();

        if (!source.permissionsFor(sourceBot).has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory
        ])) {
            throw new Error('Missing source channel permissions.');
        }

        if (!destination.permissionsFor(destBot).has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageWebhooks
        ])) {
            throw new Error('Missing destination webhook permissions.');
        }

        const progress = await readProgress();

        if (progress.completed) {
            console.log('This channel was already copied.');
            return;
        }

        const messages = await getAllMessages(
            source,
            progress.lastMessageId
        );

        console.log(`Ready to copy ${messages.length} messages.`);

        const webhook = await destination.createWebhook({
            name: 'Server History Migration'
        });

        let copied = 0;
        let failed = 0;

        for (const message of messages) {
            const author = message.author;

            const timestamp = new Date(
                message.createdTimestamp
            ).toISOString();

            const attribution = `Original: ${timestamp}`;

            const text = message.content || '';

            const attachmentLinks = [
                ...message.attachments.values()
            ].map(file => file.url);

            const content = [
                text,
                ...attachmentLinks,
                attribution
            ].filter(Boolean).join('\n');

            try {
                await webhook.send({
                    username: (
                        author?.displayName ||
                        author?.username ||
                        'Unknown User'
                    ).slice(0, 80),

                    avatarURL: author?.displayAvatarURL() || undefined,

                    content: content.slice(0, 2000) || ' ',

                    allowedMentions: { parse: [] }
                });

                copied++;

                progress.lastMessageId = message.id;
                await saveProgress(progress);

                if (copied % 25 === 0) {
                    console.log(`Copied ${copied} messages...`);
                }

                await sleep(400);

            } catch (error) {
                failed++;
                console.error(
                    `Failed message ${message.id}:`,
                    error.message
                );

                // Stop to avoid skipping messages.
                break;
            }
        }

        if (failed === 0) {
            progress.completed = true;
            await saveProgress(progress);
        }

        console.log(`Copied: ${copied}`);
        console.log(`Failed: ${failed}`);
        console.log('Finished.');

    } finally {
        client.destroy();
    }
}

main().catch(error => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
});
