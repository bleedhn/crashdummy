import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const appId = process.env.CLIENT_ID;
const fix = process.argv.includes('--fix');

const global = await rest.get(Routes.applicationCommands(appId));
console.log(`GLOBAL: ${global.filter(c => c.name === 'massunban').length}x massunban (${global.length} total commands)`);

const guilds = await rest.get(Routes.userGuilds());
for (const g of guilds) {
    const cmds = await rest.get(Routes.applicationGuildCommands(appId, g.id));
    if (cmds.length === 0) continue;
    console.log(`SERVER "${g.name}" (${g.id}): ${cmds.length} server-only commands -> ${cmds.map(c => c.name).join(', ')}`);
    if (fix) {
        await rest.put(Routes.applicationGuildCommands(appId, g.id), { body: [] });
        console.log('  -> cleared');
    }
}
console.log('Done.');
