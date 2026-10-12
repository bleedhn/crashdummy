
import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('massunban')
        .setDescription('Unban everyone from this server')
        .addBooleanOption(option =>
            option
                .setName('confirm')
                .setDescription('Confirm that you want to unban EVERYONE')
                .setRequired(true)
        ),

    category: 'moderation',

    async execute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return interaction.reply({
                content: '❌ This command only works in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.user.id !== guild.ownerId) {
            return interaction.reply({
                content: '❌ Only the server owner can use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const confirmed = interaction.options.getBoolean('confirm');

        if (!confirmed) {
            return interaction.reply({
                content: '❌ Mass unban cancelled.',
                flags: MessageFlags.Ephemeral
            });
        }

        const botMember = await guild.members.fetchMe();

        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({
                content: '❌ I need the Ban Members permission.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        try {
            const bans = await guild.bans.fetch();

            if (bans.size === 0) {
                return interaction.editReply({
                    content: '✅ There are no banned users in this server.'
                });
            }

            let successful = 0;
            let failed = 0;

            for (const ban of bans.values()) {
                try {
                    await guild.members.unban(
                        ban.user.id,
                        'Mass unban requested by server owner'
                    );

                    successful++;

                } catch (error) {
                    failed++;
                    console.error(
                        `Failed to unban ${ban.user.id}:`,
                        error
                    );
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('🔓 Mass Unban Complete')
                .setDescription(
                    `**Mass unban results**\n\n` +
                    `✅ Successfully unbanned: **${successful}**\n` +
                    `❌ Failed: **${failed}**\n` +
                    `📋 Total processed: **${bans.size}**`
                )
                .setFooter({
                    text: `Executed by ${interaction.user.username}`
                })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('Mass unban error:', error);

            await interaction.editReply({
                content: '❌ An error occurred while processing the mass unban.'
            });
        }
    }
};
