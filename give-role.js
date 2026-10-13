import { REST, Routes } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;

const [SERVER_ID, USER_ID, ROLE_ID] = process.argv.slice(2);

console.log('Discord token available:', Boolean(TOKEN));

if (!TOKEN) {
    console.error('ERROR: DISCORD_TOKEN is missing!');
    process.exit(1);
}

if (!SERVER_ID || !USER_ID || !ROLE_ID) {
    console.error('Usage: node give-role.js SERVER_ID USER_ID ROLE_ID');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function giveRole() {
    try {
        await rest.put(
            Routes.guildMemberRole(SERVER_ID, USER_ID, ROLE_ID),
            { body: {} }
        );

        console.log('SUCCESS: Role assigned!');
    } catch (error) {
        console.error('Failed to give role:', error);
    }
}

giveRole();
