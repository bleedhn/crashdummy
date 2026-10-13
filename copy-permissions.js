
import {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    ChannelType,
    OverwriteType
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const [SOURCE_ID, DEST_ID, MODE = 'preview'] = process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node copy-permissions.js SOURCE_ID DEST_ID preview|apply'
    );
    process.exit(1);
}

if (SOURCE_ID === DEST_ID) {
    throw new Error('Source and destination must be different.');
}

if (!['preview', 'apply'].includes(MODE)) {
    throw new Error('Mode must be preview or apply.');
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

function key(channel) {
    return JSON.stringify([
        channel.type,
        channel.parent?.name ?? 'ROOT',
        channel.name
    ]);
}

async function main() {
    try {
        await client.login(TOKEN);

        const source = await client.guilds.fetch(SOURCE_ID);
        const dest = await client.guilds.fetch(DEST_ID);

        await source.roles.fetch();
        await dest.roles.fetch();
        await source.channels.fetch();
        await dest.channels.fetch();

        const bot = await dest.members.fetchMe();

        if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error('Bot needs Manage Roles permission.');
        }

        const roleMap = new Map([[source.id, dest.id]]);
        const used = new Set();

        let rolesUpdated = 0;
        let channelsUpdated = 0;
        let skipped = 0;
        let failed = 0;

        console.log(`MODE: ${MODE.toUpperCase()}`);

        // 1. Match and update server-wide role permissions
        console.log('\n--- SERVER ROLE PERMISSIONS ---');

        const sourceRoles = [...source.roles.cache.values()]
            .filter(r => r.id !== source.id);

        const destRoles = [...dest.roles.cache.values()]
            .filter(r => r.id !== dest.id);

        for (const role of sourceRoles) {
            const matches = destRoles.filter(r =>
                r.name === role.name &&
                !used.has(r.id)
            );

            if (matches.length !== 1) {
                console.log(`SKIP role: ${role.name} (ambiguous/missing)`);
                skipped++;
                continue;
            }

            const match = matches[0];
            used.add(match.id);
            roleMap.set(role.id, match.id);

            if (role.managed || match.managed) {
                console.log(`Managed role: ${role.name} (not editable)`);
                continue;
            }

            if (!match.editable) {
                console.log(`SKIP role: ${role.name} (above bot)`);
                skipped++;
                continue;
            }

            console.log(`${MODE}: Role ${role.name}`);

            if (MODE === 'apply') {
                try {
                    await match.setPermissions(
                        role.permissions,
                        'Copy original server role permissions'
                    );
                    rolesUpdated++;
                } catch (error) {
                    failed++;
                    console.error(`FAILED role ${role.name}: ${error.message}`);
                }
            }
        }

        // @everyone base permissions
        console.log(`${MODE}: @everyone`);

        if (MODE === 'apply') {
            try {
                await dest.roles.everyone.setPermissions(
                    source.roles.everyone.permissions,
                    'Copy original @everyone permissions'
                );
                rolesUpdated++;
            } catch (error) {
                failed++;
                console.error(`FAILED @everyone: ${error.message}`);
            }
        }

        // 2. Copy category and channel permission overwrites
        console.log('\n--- CATEGORY & CHANNEL PERMISSIONS ---');

        const sourceChannels = [...source.channels.cache.values()]
            .filter(c => !c.isThread() && c.permissionOverwrites)
            .sort((a, b) => {
                if (a.type === ChannelType.GuildCategory &&
                    b.type !== ChannelType.GuildCategory) return -1;
                if (b.type === ChannelType.GuildCategory &&
                    a.type !== ChannelType.GuildCategory) return 1;
                return a.rawPosition - b.rawPosition;
            });

        const destChannels = [...dest.channels.cache.values()]
            .filter(c => !c.isThread() && c.permissionOverwrites);

        const channelMap = new Map();

        for (const src of sourceChannels) {
            const matches = destChannels.filter(d => key(d) === key(src));

            if (matches.length === 1) {
                channelMap.set(src.id, matches[0]);
            } else {
                console.log(`SKIP channel: ${src.name} (missing/ambiguous)`);
                skipped++;
            }
        }

        for (const src of sourceChannels) {
            const dst = channelMap.get(src.id);
            if (!dst) continue;

            const overwrites = [];
            let safe = true;

            for (const overwrite of src.permissionOverwrites.cache.values()) {
                if (overwrite.type !== OverwriteType.Role) {
                    console.log(
                        `SKIP ${src.name}: member-specific override`
                    );
                    safe = false;
                    break;
                }

                const mapped = roleMap.get(overwrite.id);

                if (!mapped) {
                    console.log(
                        `SKIP ${src.name}: unmapped role ${overwrite.id}`
                    );
                    safe = false;
                    break;
                }

                overwrites.push({
                    id: mapped,
                    type: OverwriteType.Role,
                    allow: overwrite.allow.bitfield,
                    deny: overwrite.deny.bitfield
                });
            }

            if (!safe) {
                skipped++;
                continue;
            }

            console.log(
                `${MODE}: ${src.name} (${overwrites.length} overrides)`
            );

            if (MODE !== 'apply') continue;

            try {
                // Preserve synchronization with category if possible
                const parent = src.parentId
                    ? channelMap.get(src.parentId)
                    : null;

                if (parent && dst.parentId !== parent.id) {
                    await dst.setParent(parent.id, { lockPermissions: false });
                }

                if (
                    src.parentId &&
                    src.permissionsLocked &&
                    parent
                ) {
                    await dst.lockPermissions();
                } else {
                    await dst.permissionOverwrites.set(
                        overwrites,
                        'Copy original channel permissions'
                    );
                }

                channelsUpdated++;
                console.log(`SUCCESS: ${src.name}`);

            } catch (error) {
                failed++;
                console.error(`FAILED ${src.name}: ${error.message}`);
            }
        }

        console.log('\n================================');
        console.log('PERMISSIONS COPY FINISHED');
        console.log(`Roles updated: ${rolesUpdated}`);
        console.log(`Categories/channels updated: ${channelsUpdated}`);
        console.log(`Skipped: ${skipped}`);
        console.log(`Failed: ${failed}`);

        if (MODE === 'preview') {
            console.log('Preview only. No changes were made.');
        }

    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
}

main();
