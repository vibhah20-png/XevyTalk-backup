import '../env.js';
import nodemailer from 'nodemailer';

// Confirm environment status safely
if (typeof process !== 'undefined' && process.env) {
  console.log("✓ Environment initialized in email helper");
}
const emailTransporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // true for 465, false for other ports
  pool: true,
  maxConnections: 3,
  maxMessages: 10,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 7000,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export const sendWelcomeEmail = async (email, username, password) => {
  const mailOptions = {
    from: `"XevyTalk Admin" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Welcome to XevyTalk - Your Account Credentials',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to XevyTalk</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 0; }
          .wrapper { width: 100%; background-color: #f4f4f5; padding: 40px 0; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
          .header { background-color: #ffffff; padding: 40px 40px 20px; text-align: center; }
          .logo { font-size: 32px; font-weight: 800; color: #0891b2; text-decoration: none; display: inline-block; }
          .content { padding: 20px 40px 40px; }
          .greeting { font-size: 24px; font-weight: 700; color: #18181b; margin-bottom: 16px; }
          .text { color: #52525b; font-size: 16px; margin-bottom: 24px; }
          .credentials-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
          .credential-row { margin-bottom: 12px; }
          .credential-row:last-child { margin-bottom: 0; }
          .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 4px; }
          .value { font-family: 'Monaco', 'Consolas', monospace; font-size: 16px; color: #0f172a; font-weight: 500; background: #fff; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block; }
          .button-container { text-align: center; margin-top: 32px; margin-bottom: 32px; }
          .button { background-color: #0891b2; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 16px; display: inline-block; transition: background-color 0.2s; }
          .button:hover { background-color: #0e7490; }
          .alert { background-color: #fff7ed; border-left: 4px solid #f97316; padding: 16px; border-radius: 4px; margin-bottom: 24px; }
          .alert-text { color: #9a3412; font-size: 14px; margin: 0; }
          .footer { background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer-text { color: #94a3b8; font-size: 12px; margin: 0; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <div class="logo">💬 XevyTalk</div>
            </div>
            <div class="content">
              <h1 class="greeting">Hello, ${username}!</h1>
              <p class="text">Welcome to the team. Your account has been created successfully. Here are your temporary login credentials:</p>
              
              <div class="credentials-box">
                <div class="credential-row">
                  <div class="label">Email Address</div>
                  <div class="value">${email}</div>
                </div>
                <div class="credential-row">
                  <div class="label">Temporary Password</div>
                  <div class="value">${password}</div>
                </div>
              </div>

              <div class="alert">
                <p class="alert-text"><strong>Security Notice:</strong> You will be required to change this password immediately upon your first login.</p>
              </div>

              <div class="button-container">
                <a href="${process.env.FRONTEND_URL || 'http://13.205.101.250:3000'}/login" class="button">Login to Account</a>
              </div>
              
              <p class="text" style="font-size: 14px; color: #71717a; text-align: center;">If the button doesn't work, copy this link:<br><a href="${process.env.FRONTEND_URL || 'http://13.205.101.250:3000'}/login" style="color: #0891b2;">${process.env.FRONTEND_URL || 'http://13.205.101.250:3000'}/login</a></p>
            </div>
            <div class="footer">
              <p class="footer-text">&copy; ${new Date().getFullYear()} XevyTalk. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  const sendWithTimeout = (opts, ms = 7000) => Promise.race([
    emailTransporter.sendMail(opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timeout')), ms))
  ]);

  try {
    await sendWithTimeout(mailOptions);
    console.log(`✓ Welcome email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending email (continuing without blocking user creation):', error?.message || error);
    return false;
  }
};

export { emailTransporter };
