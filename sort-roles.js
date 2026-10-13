
import {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const [SOURCE_ID, DEST_ID] = process.argv.slice(2);

if (!TOKEN || !SOURCE_ID || !DEST_ID) {
    console.error(
        'Usage: node sort-roles.js SOURCE_ID DEST_ID'
    );
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

async function main() {
    try {
        await client.login(TOKEN);

        const source = await client.guilds.fetch(SOURCE_ID);
        const dest = await client.guilds.fetch(DEST_ID);

        await source.roles.fetch();
        await dest.roles.fetch();

        const bot = await dest.members.fetchMe();

        if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error('Bot needs Manage Roles permission.');
        }

        const sourceRoles = [...source.roles.cache.values()]
            .filter(r => r.id !== source.id && !r.managed)
            .sort((a, b) => a.comparePositionTo(b));

        const destRoles = [...dest.roles.cache.values()]
            .filter(r => r.id !== dest.id && !r.managed && r.editable);

        const used = new Set();
        const ordered = [];

        for (const sourceRole of sourceRoles) {
            const match = destRoles.find(r =>
                r.name === sourceRole.name &&
                !used.has(r.id)
            );

            if (match) {
                used.add(match.id);
                ordered.push(match);
            } else {
                console.log(`Unmatched: ${sourceRole.name}`);
            }
        }

        // Only rearrange positions currently occupied by
        // matched roles, keeping restricted roles untouched.
        const slots = ordered
            .map(r => r.position)
            .sort((a, b) => a - b);

        const updates = ordered.map((role, i) => ({
            role: role.id,
            position: slots[i]
        }));

        console.log('Applying role hierarchy...');

        await dest.roles.setPositions(updates);

        // Fetch again to verify actual Discord order.
        await dest.roles.fetch();

        const actual = [...dest.roles.cache.values()]
            .filter(r => used.has(r.id))
            .sort((a, b) => a.comparePositionTo(b))
            .map(r => r.id);

        const expected = ordered.map(r => r.id);

        console.log('\nEXPECTED ORDER (bottom to top):');
        for (const role of ordered) {
            console.log(role.name);
        }

        console.log('\nACTUAL ORDER (bottom to top):');
        const actualRoles = [...dest.roles.cache.values()]
            .filter(r => used.has(r.id))
            .sort((a, b) => a.comparePositionTo(b));

        for (const role of actualRoles) {
            console.log(role.name);
        }

        if (expected.every((id, i) => id === actual[i])) {
            console.log('\nSUCCESS: Matching roles are correctly ordered!');
        } else {
            console.log(
                '\nWARNING: Discord returned a different order.'
            );
            console.log(
                'Check role hierarchy and managed roles.'
            );
        }

    } catch (error) {
        console.error('Sorting failed:', error);
    } finally {
        client.destroy();
    }
}

main();
