const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('massunban')
        .setDescription('Unban everyone from this server')
        .addBooleanOption(option =>
            option
                .setName('confirm')
                .setDescription('Set to true to confirm unbanning everyone')
                .setRequired(true)
        ),

    async execute(interaction) {
        const { guild, user } = interaction;

        if (!guild) {
            return interaction.reply({
                content: 'This command only works in a server.',
                ephemeral: true
            });
        }

        if (user.id !== guild.ownerId) {
            return interaction.reply({
                content: '❌ Only the server owner can use this command.',
                ephemeral: true
            });
        }

        const confirmed = interaction.options.getBoolean('confirm');

        if (!confirmed) {
            return interaction.reply({
                content: 'Mass unban cancelled. Set confirm to true to continue.',
                ephemeral: true
            });
        }

        const botMember = await guild.members.fetchMe();

        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({
                content: '❌ I need the Ban Members permission.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const bans = await guild.bans.fetch();

            if (bans.size === 0) {
                return interaction.editReply({
                    content: 'There are no banned users in this server.'
                });
            }

            let successful = 0;
            let failed = 0;

            for (const ban of bans.values()) {
                try {
                    await guild.members.unban(ban.user.id);
                    successful++;
                } catch (error) {
                    failed++;
                    console.error(`Failed to unban ${ban.user.id}:`, error);
                }
            }

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('Mass Unban Complete')
                .setDescription(
                    `✅ Successfully unbanned: **${successful}** users\n` +
                    `❌ Failed: **${failed}** users`
                )
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('Mass unban error:', error);

            await interaction.editReply({
                content: '❌ An error occurred while fetching banned users.'
            });
        }
    }
};
