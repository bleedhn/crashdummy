
import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const TOKEN =
    process.env.TOKEN ||
    process.env.DISCORD_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

if (!TOKEN) {
    console.error('ERROR: Discord bot token is missing!');
    console.error('Check your Railway service variables.');
    process.exit(1);
}

const SERVER_ID = '1071823690611834900';
const USER_ID = '1559435216039313421';
const ROLE_ID = '1556785571639070771';

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function giveRole() {
    try {
        await rest.put(
            Routes.guildMemberRole(
                SERVER_ID,
                USER_ID,
                ROLE_ID
            ),
            { body: {} }
        );

        console.log('Successfully gave the user the role!');
    } catch (error) {
        console.error('Failed to give role:', error);
    }
}

giveRole();
