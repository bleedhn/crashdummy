
import {
    Client,
    GatewayIntentBits,
    ChannelType
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;

const [SOURCE_ID, DEST_ID] = process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node clone-server.js SOURCE_ID DEST_ID'
    );
    process.exit(1);
}

if (SOURCE_ID === DEST_ID) {
    console.error('Source and destination must be different.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

async function cloneServer() {
    try {
        await client.login(TOKEN);

        const source = await client.guilds.fetch(SOURCE_ID);
        const dest = await client.guilds.fetch(DEST_ID);

        await source.roles.fetch();
        await source.channels.fetch();
        await dest.roles.fetch();
        await dest.channels.fetch();

        const roleMap = new Map();
        const channelMap = new Map();

        roleMap.set(source.id, dest.id);

        console.log('Copying server roles...');

        await dest.roles.everyone.setPermissions(
            source.roles.everyone.permissions
        );

        const roles = [...source.roles.cache.values()]
            .filter(role =>
                role.id !== source.id &&
                !role.managed
            )
            .sort((a, b) => a.position - b.position);

        for (const role of roles) {
            try {
                const newRole = await dest.roles.create({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    permissions: role.permissions,
                    reason: 'Server structure clone'
                });

                roleMap.set(role.id, newRole.id);
                console.log(`Created role: ${role.name}`);
            } catch (error) {
                console.error(
                    `Failed role ${role.name}:`,
                    error.message
                );
            }
        }

        // Recreate role order where permitted.
        const positions = roles
            .filter(role => roleMap.has(role.id))
            .map((role, index) => ({
                role: roleMap.get(role.id),
                position: index + 1
            }));

        try {
            await dest.roles.setPositions(positions);
        } catch (error) {
            console.log(
                'Could not fully restore role order:',
                error.message
            );
        }

        function copyOverwrites(channel) {
            return channel.permissionOverwrites.cache
                .filter(overwrite => roleMap.has(overwrite.id))
                .map(overwrite => ({
                    id: roleMap.get(overwrite.id),
                    allow: overwrite.allow,
                    deny: overwrite.deny
                }));
        }

        console.log('Copying categories...');

        const categories = [...source.channels.cache.values()]
            .filter(c => c.type === ChannelType.GuildCategory)
            .sort((a, b) => a.rawPosition - b.rawPosition);

        for (const category of categories) {
            try {
                const created = await dest.channels.create({
                    name: category.name,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: copyOverwrites(category)
                });

                channelMap.set(category.id, created.id);
                console.log(`Created category: ${category.name}`);
            } catch (error) {
                console.error(
                    `Failed category ${category.name}:`,
                    error.message
                );
            }
        }

        console.log('Copying channels...');

        const channels = [...source.channels.cache.values()]
            .filter(c =>
                c.type !== ChannelType.GuildCategory &&
                c.type !== ChannelType.PublicThread &&
                c.type !== ChannelType.PrivateThread &&
                c.type !== ChannelType.AnnouncementThread
            )
            .sort((a, b) => a.rawPosition - b.rawPosition);

        for (const channel of channels) {
            try {
                const options = {
                    name: channel.name,
                    type: channel.type,
                    parent: channel.parentId
                        ? channelMap.get(channel.parentId) ?? null
                        : null,
                    permissionOverwrites: copyOverwrites(channel),
                    reason: 'Server structure clone'
                };

                if ('topic' in channel && channel.topic) {
                    options.topic = channel.topic;
                }

                if ('nsfw' in channel) {
                    options.nsfw = channel.nsfw;
                }

                if ('rateLimitPerUser' in channel) {
                    options.rateLimitPerUser =
                        channel.rateLimitPerUser;
                }

                if ('bitrate' in channel) {
                    options.bitrate = Math.min(
                        channel.bitrate,
                        dest.maximumBitrate
                    );
                }

                if ('userLimit' in channel) {
                    options.userLimit = channel.userLimit;
                }

                const created = await dest.channels.create(options);

                channelMap.set(channel.id, created.id);
                console.log(`Created channel: ${channel.name}`);
            } catch (error) {
                console.error(
                    `Failed channel ${channel.name}:`,
                    error.message
                );
            }
        }

        console.log('Restoring channel order...');

        for (const channel of channels) {
            const newId = channelMap.get(channel.id);
            if (!newId) continue;

            try {
                const created = await dest.channels.fetch(newId);
                await created.setPosition(channel.rawPosition);
            } catch (error) {
                console.error(
                    `Could not position ${channel.name}:`,
                    error.message
                );
            }
        }

        console.log('Server structure cloning complete!');
        console.log('Review roles and permissions in Discord.');

    } catch (error) {
        console.error('Clone failed:', error);
    } finally {
        client.destroy();
    }
}

cloneServer();
