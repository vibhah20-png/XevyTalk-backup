import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

console.log('🔧 Testing Email Configuration...\n');

// Check if environment variables are set
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ ERROR: Email credentials not found in .env file');
    console.log('\nPlease add the following to your .env file:');
    console.log('EMAIL_USER=your-email@gmail.com');
    console.log('EMAIL_PASS=your-16-char-app-password\n');
    process.exit(1);
}

console.log('📧 Email User:', process.env.EMAIL_USER);
console.log('🔑 Password:', process.env.EMAIL_PASS ? '***' + process.env.EMAIL_PASS.slice(-4) : 'NOT SET');
console.log('');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const testEmail = async () => {
    try {
        console.log('📤 Sending test email...');

        const info = await transporter.sendMail({
            from: `"XevyTalk Test" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: '✅ XevyTalk Email Configuration Test',
            text: 'If you receive this email, your email configuration is working correctly!',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
                        .success { background: #dcfce7; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0; border-radius: 5px; }
                        .info { background: #e0f2fe; border-left: 4px solid #0891b2; padding: 15px; margin: 20px 0; border-radius: 5px; }
                        .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>💬 XevyTalk</h1>
                            <p>Email Configuration Test</p>
                        </div>
                        <div class="content">
                            <div class="success">
                                <h2 style="margin-top: 0; color: #16a34a;">✅ Success!</h2>
                                <p>Your email configuration is working correctly.</p>
                            </div>
                            
                            <div class="info">
                                <h3 style="margin-top: 0; color: #0891b2;">Configuration Details</h3>
                                <p><strong>Email Service:</strong> Gmail SMTP</p>
                                <p><strong>Sender:</strong> ${process.env.EMAIL_USER}</p>
                                <p><strong>Test Time:</strong> ${new Date().toLocaleString()}</p>
                            </div>
                            
                            <p>Your XevyTalk application can now send:</p>
                            <ul>
                                <li>Welcome emails to new users</li>
                                <li>Password reset OTPs</li>
                                <li>Account notifications</li>
                            </ul>
                            
                            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                                <strong>Next Steps:</strong><br>
                                Your email is configured and ready to use. You can now test user creation and password reset features.
                            </p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} XevyTalk. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        });

        console.log('✅ Test email sent successfully!');
        console.log('📬 Message ID:', info.messageId);
        console.log('📨 Check your inbox:', process.env.EMAIL_USER);
        console.log('\n✨ Email configuration is working correctly!\n');

    } catch (error) {
        console.error('\n❌ Email test failed!');
        console.error('Error:', error.message);
        console.log('\n🔍 Troubleshooting:');

        if (error.message.includes('Invalid login')) {
            console.log('  • Make sure you\'re using an App Password, not your regular Gmail password');
            console.log('  • Verify 2-Step Verification is enabled on your Gmail account');
            console.log('  • Generate a new App Password at: https://myaccount.google.com/apppasswords');
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
            console.log('  • Check your internet connection');
            console.log('  • Verify firewall isn\'t blocking SMTP ports (587, 465)');
            console.log('  • Try a different network');
        } else {
            console.log('  • Check the EMAIL_USER and EMAIL_PASS in your .env file');
            console.log('  • Make sure there are no extra spaces in the credentials');
            console.log('  • Verify the Gmail account is active');
        }

        console.log('\n📖 See EMAIL_CONFIGURATION.md for detailed setup instructions\n');
        process.exit(1);
    }
};

testEmail();
