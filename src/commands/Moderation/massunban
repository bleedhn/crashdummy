const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mass-unban')
        .setDescription('Unbans EVERYONE from the server'),

    async execute(interaction) {

        const { options, guild, ownerId } = interaction;
        const users = await interaction.guild.bans.fetch();
        const ids = users.map(u => u.user.id);

        if (interaction.user.id != ownerId) return await interaction.reply({ content: 'You have to be the server owner to use this command', ephemeral: true });

        if (!users.size) return await interaction.reply({ content: 'There is no one banned in this server', ephemeral: true });

        await interaction.reply({ content: '<a:Loading:1087045463980658751> Unbanning everyone in your server, this may take time if you have a lot of banned users...' });

        for (const id of ids) {
            await guild.members.unban(id)
                .catch(err => {
                    return interaction.editReply({ content: `${err.rawError}` });
                });
        }

        const embed = new EmbedBuilder()
            .setColor("Blue")
            .setDescription(`:white_check_mark: ${ids.length} members have been **unbanned** from this server`);

        await interaction.editReply({ content: '', embeds: [embed] });

    }
}
