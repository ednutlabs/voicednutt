const { Bot } = require('grammy');
const { conversations, createConversation } = require('@grammyjs/conversations');
const { InlineKeyboard } = require('grammy');
const config = require('./config');

// Bot initialization
const token = config.botToken;
const bot = new Bot(token);

// Initialize conversations with error handling wrapper
function wrapConversation(handler, name) {
    return createConversation(async (conversation, ctx) => {
        try {
            await handler(conversation, ctx);
        } catch (error) {
            console.error(`Conversation error in ${name}:`, error);
            await ctx.reply('❌ An error occurred during the conversation. Please try again.');
        }
    }, name);
}

// Initialize middleware
bot.use(conversations());

// Global error handler
bot.catch((err) => {
    const errorMessage = `Error while handling update ${err.ctx.update.update_id}:
    ${err.error.message}
    Stack: ${err.error.stack}`;
    console.error(errorMessage);
    
    try {
        err.ctx.reply('❌ An error occurred. Please try again or contact support.');
    } catch (replyError) {
        console.error('Failed to send error message:', replyError);
    }
});

// Import dependencies
const { getUser, isAdmin, expireInactiveUsers } = require('./db/db');
const { callFlow, registerCallCommand } = require('./commands/call');
const { addUserFlow, registerAddUserCommand } = require('./commands/adduser');
const { promoteFlow, registerPromoteCommand } = require('./commands/promote');
const { removeUserFlow, registerRemoveUserCommand } = require('./commands/removeuser');

// Register conversations with error handling
bot.use(wrapConversation(callFlow, "call-conversation"));
bot.use(wrapConversation(addUserFlow, "adduser-conversation"));
bot.use(wrapConversation(promoteFlow, "promote-conversation"));
bot.use(wrapConversation(removeUserFlow, "remove-conversation"));

// Register command handlers
registerCallCommand(bot);
registerAddUserCommand(bot);
registerPromoteCommand(bot);
registerRemoveUserCommand(bot);

// Register non-conversation commands
require('./commands/users')(bot);
require('./commands/help')(bot);
require('./commands/menu')(bot);
require('./commands/guide')(bot);

// Start command handler
bot.command('start', async (ctx) => {
    try {
        expireInactiveUsers();
        
        let user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            const kb = new InlineKeyboard()
                .text('📱 Contact Admin', `https://t.me/@${config.admin.username}`);
            
            return ctx.reply('*Access Restricted* ⚠️\n\n' +
                'This bot requires authorization.\n' +
                'Please contact an administrator to get access.', {
                parse_mode: 'Markdown',
                reply_markup: kb
            });
        }

        const isOwner = await new Promise(r => isAdmin(ctx.from.id, r));
        
        // Prepare user information
        const userStats = `👤 *User Information*
• ID: \`${ctx.from.id}\`
• Username: @${ctx.from.username || 'none'}
• Role: ${user.role}
• Joined: ${new Date(user.timestamp).toLocaleDateString()}`;

        const welcomeText = isOwner ? 
            '🛡️ *Welcome, Administrator!*\n\nYou have full access to all bot features.' :
            '👋 *Welcome to Voice Call Bot!*\n\nYou can make voice calls using AI agents.';

        // Prepare keyboard
        const kb = new InlineKeyboard()
            .text('📞 New Call', 'CALL')
            .text('📚 Guide', 'GUIDE')
            .row()
            .text('❔ Help', 'HELP')
            .text('📋 Menu', 'MENU');

        if (isOwner) {
            kb.row()
                .text('➕ Add User', 'ADDUSER')
                .text('⬆️ Promote', 'PROMOTE')
                .row()
                .text('👥 Users', 'USERS')
                .text('❌ Remove', 'REMOVE');
        }

        await ctx.reply(`${welcomeText}\n\n${userStats}\n\n` +
            'Use the buttons below or type /help for available commands.', {
            parse_mode: 'Markdown',
            reply_markup: kb
        });
    } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply('❌ An error occurred. Please try again or contact support.');
    }
});

// Callback query handler with improved error handling
bot.on('callback_query:data', async (ctx) => {
    try {
        // Answer callback query immediately to prevent timeout
        await ctx.answerCallbackQuery();

        // Verify user authorization
        const user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            await ctx.reply("❌ You are not authorized to use this bot.");
            return;
        }

        // Check admin permissions
        const isAdmin = user.role === 'ADMIN';
        const adminActions = ['ADDUSER', 'PROMOTE', 'REMOVE', 'USERS'];
        
        if (adminActions.includes(ctx.callbackQuery.data) && !isAdmin) {
            await ctx.reply("❌ This action is for administrators only.");
            return;
        }

        // Handle different types of actions
        const conversations = {
            'CALL': 'call-conversation',
            'ADDUSER': 'adduser-conversation',
            'PROMOTE': 'promote-conversation',
            'REMOVE': 'remove-conversation'
        };

        const commands = {
            'HELP': '/help',
            'USERS': '/users',
            'GUIDE': '/guide',
            'MENU': '/menu'
        };

        // Process conversation actions
        if (conversations[ctx.callbackQuery.data]) {
            await ctx.reply(`Starting ${ctx.callbackQuery.data.toLowerCase()} process...`);
            await ctx.conversation.enter(conversations[ctx.callbackQuery.data]);
            return;
        }

        // Process command actions
        if (commands[ctx.callbackQuery.data]) {
            await ctx.reply(commands[ctx.callbackQuery.data]);
            return;
        }

        // Handle unknown actions
        await ctx.reply("❌ Unknown action. Please try again.");

    } catch (error) {
        console.error('Callback query error:', error);
        await ctx.reply("❌ An error occurred. Please try again.");
    }
});

// Register bot commands
bot.api.setMyCommands([
    { command: 'start', description: 'Start or restart the bot' },
    { command: 'call', description: 'Start outbound voice call' },
    { command: 'guide', description: 'Show detailed usage guide' },
    { command: 'help', description: 'Show available commands' },
    { command: 'menu', description: 'Show quick action menu' },
    { command: 'adduser', description: 'Add user (admin only)' },
    { command: 'promote', description: 'Promote to ADMIN (admin only)' },
    { command: 'removeuser', description: 'Remove a USER (admin only)' },
    { command: 'users', description: 'List authorized users (admin only)' }
]);

// Start the bot
bot.start();