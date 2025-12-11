import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const lastLog = await prisma.notificationLog.findFirst({
        orderBy: { sentAt: 'desc' },
    });

    if (!lastLog) {
        console.log('No notification logs found.');
    } else {
        console.log('Latest Notification Log:');
        console.log(JSON.stringify(lastLog, null, 2));
    }

    const emailConfig = await prisma.integrationConfig.findUnique({
        where: { type: 'EMAIL' }
    });
    console.log('Email Config Present:', !!emailConfig);
    if (emailConfig) {
        console.log('Email Config Enabled:', emailConfig.isEnabled);
        console.log('Email Config Host:', emailConfig.host);
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
