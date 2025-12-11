const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');

const prisma = new PrismaClient();

async function main() {
    console.log("Fetching Email Configuration...");
    const config = await prisma.integrationConfig.findUnique({
        where: { type: 'EMAIL' },
    });

    if (!config) {
        console.error("No EMAIL configuration found!");
        return;
    }

    console.log(`Config Found: Host=${config.host}, Port=${config.port}, User=${config.username}, Encryption=${config.encryption}`);

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port || '587'),
        secure: config.encryption === 'SSL',
        auth: {
            user: config.username,
            pass: config.password,
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log("Attempting to verify connection...");
        await transporter.verify();
        console.log("SMTP Connection successful!");

        console.log("Attempting to send test email...");
        const info = await transporter.sendMail({
            from: `"${config.fromName}" <${config.senderEmail}>`,
            to: "test@example.com", // Dummy receiver, we just want to see if it accepts the handoff
            subject: "Test Email from Diagnostic Script",
            text: "This is a test to verify SMTP settings.",
        });

        console.log("Message sent: %s", info.messageId);
    } catch (error) {
        console.error("---------------------------------------------------");
        console.error("SMTP ERROR OCCURRED:");
        console.error(error);
        console.error("---------------------------------------------------");

        if (error.code === 'EAUTH') {
            console.error("Diagnosis: Authentication Failed. Check Username and Password.");
        } else if (error.code === 'ESOCKET') {
            console.error("Diagnosis: Connection Failed. Check Host and Port.");
        } else if (error.code === 'ECONNREFUSED') {
            console.error("Diagnosis: Connection Refused. The server rejected the connection.");
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
