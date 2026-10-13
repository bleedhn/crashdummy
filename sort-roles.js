
import {
    Client,
    GatewayIntentBits
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const [SOURCE_ID, DEST_ID] = process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node sort-roles.js SOURCE_SERVER_ID DEST_SERVER_ID'
    );
    process.exit(1);
}

if (SOURCE_ID === DEST_ID) {
    throw new Error('Source and destination must differ.');
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

async function sortRoles() {
    try {
        await client.login(TOKEN);

        const source = await client.guilds.fetch(SOURCE_ID);
        const destination = await client.guilds.fetch(DEST_ID);

        await source.roles.fetch();
        await destination.roles.fetch();

        const botMember = await destination.members.fetchMe();

        if (!botMember.permissions.has('ManageRoles')) {
            throw new Error('Bot needs Manage Roles permission.');
        }

        // Original roles ordered from bottom to top
        const sourceRoles = [...source.roles.cache.values()]
            .filter(role => !role.managed && role.id !== source.id)
            .sort((a, b) => a.position - b.position);

        // Destination roles the bot can actually move
       const botHighest = botMember.roles.highest.position;

const destRoles = [...destination.roles.cache.values()]
    .filter(role =>
        role.id !== destination.id &&
        !role.managed &&
        role.editable &&
        role.position < botHighest
    );

        const usedIds = new Set();
        const matches = [];

        for (const sourceRole of sourceRoles) {
            const match = destRoles.find(role =>
                role.name === sourceRole.name &&
                !usedIds.has(role.id)
            );

            if (match) {
                usedIds.add(match.id);
                matches.push({
                    source: sourceRole,
                    destination: match
                });
            } else {
                console.log(
                    `Cannot match or move: ${sourceRole.name}`
                );
            }
        }

        if (matches.length === 0) {
            console.log('No matching movable roles found.');
            return;
        }

        // Use the existing movable role positions.
        // This avoids trying to move roles above the bot.
        const positions = destRoles
            .filter(role => usedIds.has(role.id))
            .map(role => role.position)
            .sort((a, b) => a - b);

        const updates = matches.map((pair, index) => ({
            role: pair.destination.id,
            position: positions[index]
        }));

        console.log(
            `Reordering ${updates.length} matching roles...`
        );

        console.log('Bot highest role:', botMember.roles.highest.name);
console.log('Bot highest position:', botHighest);
console.log('Roles being reordered:', updates.length);
console.log('Requested updates:', updates);

        console.log('Role sorting complete!');

        for (const pair of matches) {
            console.log(`Matched: ${pair.source.name}`);
        }

        console.log(
            'Review the destination role hierarchy in Discord.'
        );

    } catch (error) {
        console.error('Role sorting failed:', error);
    } finally {
        client.destroy();
    }
}

sortRoles();
