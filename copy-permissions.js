
import {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const [SOURCE_ID, DEST_ID, MODE = 'preview'] =
    process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node copy-permissions.js SOURCE_ID DEST_ID [preview|apply]'
    );
    process.exit(1);
}

if (SOURCE_ID === DEST_ID) {
    throw new Error('Source and destination must differ.');
}

if (!['preview', 'apply'].includes(MODE)) {
    throw new Error('Mode must be preview or apply.');
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

function channelKey(channel) {
    const parentName = channel.parent?.name ?? 'ROOT';

    return JSON.stringify([
        channel.type,
        parentName,
        channel.name
    ]);
}

async function main() {
    try {
        await client.login(TOKEN);

        const source = await client.guilds.fetch(SOURCE_ID);
        const dest = await client.guilds.fetch(DEST_ID);

        await Promise.all([
            source.roles.fetch(),
            dest.roles.fetch(),
            source.channels.fetch(),
            dest.channels.fetch()
        ]);

        const bot = await dest.members.fetchMe();

        if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error('Bot needs Manage Roles permission.');
        }

        const roleMap = new Map([
            [source.id, dest.id]
        ]);

        const sourceRoles = [...source.roles.cache.values()]
            .filter(r => r.id !== source.id);

        for (const role of sourceRoles) {
            const matches = [...dest.roles.cache.values()]
                .filter(r => r.name === role.name);

            if (matches.length === 1) {
                roleMap.set(role.id, matches[0].id);
            } else {
                console.log(
                    `WARNING: Role unmatched or ambiguous: ${role.name}`
                );
            }
        }

        const sourceChannels = [...source.channels.cache.values()]
            .filter(c =>
                !c.isThread() &&
                c.permissionOverwrites
            )
            .sort((a, b) => {
                if (a.type === ChannelType.GuildCategory &&
                    b.type !== ChannelType.GuildCategory) return -1;

                if (b.type === ChannelType.GuildCategory &&
                    a.type !== ChannelType.GuildCategory) return 1;

                return a.rawPosition - b.rawPosition;
            });

        const destChannels = [...dest.channels.cache.values()]
            .filter(c =>
                !c.isThread() &&
                c.permissionOverwrites
            );

        let copied = 0;
        let skipped = 0;
        let failed = 0;

        console.log(`Mode: ${MODE.toUpperCase()}`);

        for (const sourceChannel of sourceChannels) {
            const key = channelKey(sourceChannel);

            const matches = destChannels.filter(
                c => channelKey(c) === key
            );

            if (matches.length !== 1) {
                console.log(
                    `SKIPPED: ${sourceChannel.name} (missing or ambiguous channel)`
                );
                skipped++;
                continue;
            }

            const destChannel = matches[0];
            const overwrites = [];
            let unsafe = false;

            for (const overwrite of
                sourceChannel.permissionOverwrites.cache.values()) {

                let targetId;

                if (overwrite.type === OverwriteType.Role) {
                    targetId = roleMap.get(overwrite.id);
                } else {
                    // Member-specific permissions cannot be
                    // safely translated between servers.
                    console.log(
                        `WARNING: Member overwrite in ${sourceChannel.name}`
                    );
                    unsafe = true;
                    break;
                }

                if (!targetId) {
                    console.log(
                        `WARNING: Missing role for overwrite in ${sourceChannel.name}`
                    );
                    unsafe = true;
                    break;
                }

                overwrites.push({
                    id: targetId,
                    type: OverwriteType.Role,
                    allow: overwrite.allow.bitfield,
                    deny: overwrite.deny.bitfield
                });
            }

            if (unsafe) {
                console.log(
                    `SKIPPED: ${sourceChannel.name} (unmapped permissions)`
                );
                skipped++;
                continue;
            }

            console.log(
                `${MODE === 'apply' ? 'COPYING' : 'PREVIEW'}: ` +
                `${sourceChannel.name} (${overwrites.length} overwrites)`
            );

            if (MODE === 'preview') {
                continue;
            }

            try {
                await destChannel.permissionOverwrites.set(
                    overwrites,
                    'Copy permissions from original server'
                );

                copied++;
                console.log(`SUCCESS: ${sourceChannel.name}`);

            } catch (error) {
                failed++;
                console.error(
                    `FAILED: ${sourceChannel.name}: ${error.message}`
                );
            }
        }

        console.log('\n-----------------------------');
        console.log('Permission migration finished');
        console.log(`Applied: ${copied}`);
        console.log(`Skipped: ${skipped}`);
        console.log(`Failed: ${failed}`);

        if (MODE === 'preview') {
            console.log(
                'Preview only. No permissions were changed.'
            );
        }

    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
}

main();
