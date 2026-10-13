import { REST, Routes } from 'discord.js';

const [guildId, userId, roleId] = process.argv.slice(2);
const token = process.env.TOKEN;

if (!token || !guildId || !userId || !roleId) {
    console.error('Usage: node give-role.js GUILD_ID USER_ID ROLE_ID');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

try {
    await rest.put(
        Routes.guildMemberRole(guildId, userId, roleId),
        { body: {} }
    );

    console.log('Successfully assigned the Discord role!');
} catch (error) {
    console.error('Failed to assign role:', error.message);
    process.exitCode = 1;
}
