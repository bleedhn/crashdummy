
import {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits
} from 'discord.js';

import fs from 'node:fs/promises';

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

const progressFile =
    `copy-progress-${SOURCE_ID}-${DEST_ID}.json`;

async function main() {
    try {
        await client.login(TOKEN);

        const source = await client.channels.fetch(SOURCE_ID);
        const destination = await client.channels.fetch(DEST_ID);

        if (
            !source?.messages ||
            !destination?.send ||
            !source.guild ||
            !destination.guild
        ) {
            throw new Error('Invalid source or destination channel.');
        }

        const sourceMember = await source.guild.members.fetchMe();
        const destMember = await destination.guild.members.fetchMe();

        if (!source.permissionsFor(sourceMember).has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory
        ])) {
            throw new Error('Missing source channel permissions.');
        }

        if (!destination.permissionsFor(destMember).has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ])) {
            throw new Error('Missing destination channel permissions.');
        }

        let progress = { lastMessageId: null };

        try {
            progress = JSON.parse(
                await fs.readFile(progressFile, 'utf8')
            );
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        console.log('Fetching messages...');

        const messages = [];
        let before;

        while (true) {
            const batch = await source.messages.fetch({
                limit: 100,
                ...(before ? { before } : {})
            });

            if (!batch.size) break;

            const sorted = [...batch.values()].sort(
                (a, b) =>
                    BigInt(a.id) < BigInt(b.id) ? -1 : 1
            );

            for (const message of sorted) {
                if (
                    !progress.lastMessageId ||
                    BigInt(message.id) >
                    BigInt(progress.lastMessageId)
                ) {
                    messages.push(message);
                }
            }

            before = sorted[0].id;

            if (batch.size < 100) break;

            if (
                progress.lastMessageId &&
                BigInt(before) <=
                BigInt(progress.lastMessageId)
            ) break;
        }

        messages.sort((a, b) =>
            BigInt(a.id) < BigInt(b.id) ? -1 : 1
        );

        console.log(`Found ${messages.length} messages to copy.`);

        let copied = 0;
        let skipped = 0;

        for (const message of messages) {
            console.log(
                `Processing ${message.id}: ${message.embeds.length} embeds`
            );

            const embeds = message.embeds
                .filter(embed => embed.data.type === 'rich')
                .slice(0, 10)
                .map(embed => embed.toJSON());

            const content = message.content?.slice(0, 2000) || '';

            const attachments = [
                ...message.attachments.values()
            ].map(file => file.url);

            const attachmentText = attachments.join('\n');

            let finalContent = [
                content,
                attachmentText
            ].filter(Boolean).join('\n');

            finalContent = finalContent.slice(0, 2000);

            if (!finalContent.trim() && embeds.length === 0) {
                console.log(`Skipping unsupported message ${message.id}`);
                skipped++;
            } else {
                await destination.send({
                    content: finalContent || undefined,
                    embeds,
                    allowedMentions: { parse: [] }
                });

                copied++;
                console.log(`Copied message ${message.id}`);
            }

            progress.lastMessageId = message.id;

            await fs.writeFile(
                progressFile,
                JSON.stringify(progress, null, 2)
            );
        }

        console.log('--------------------------------');
        console.log('Message copying complete!');
        console.log(`Copied: ${copied}`);
        console.log(`Skipped: ${skipped}`);

    } catch (error) {
        console.error('Copy failed:', error);
    } finally {
        client.destroy();
    }
}

main();
