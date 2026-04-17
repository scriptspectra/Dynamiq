import { prisma } from '@/libs/database';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';

// Clerk Webhook: create or delete a user in the database by Clerk ID
export async function POST(req: Request) {
    try {
        const signingSecret =
            process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
            process.env.CLERK_WEBHOOK_SECRET;
        if (!signingSecret) {
            return NextResponse.json(
                { error: 'Missing Clerk webhook signing secret' },
                { status: 500 },
            );
        }

        const svixId = req.headers.get('svix-id');
        const svixTimestamp = req.headers.get('svix-timestamp');
        const svixSignature = req.headers.get('svix-signature');
        if (!svixId || !svixTimestamp || !svixSignature) {
            return NextResponse.json(
                { error: 'Missing Svix webhook headers' },
                { status: 400 },
            );
        }

        // Parse and verify the signed Clerk webhook event
        const payload = await req.text();
        const wh = new Webhook(signingSecret);
        const evt = wh.verify(payload, {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        }) as WebhookEvent;

        const { id: clerkUserId } = evt.data;
        if (!clerkUserId)
            return NextResponse.json(
                { error: 'No user ID provided' },
                { status: 400 },
            );

        // Create or delete a user in the database based on the Clerk Webhook event
        let user = null;
        switch (evt.type) {
            case 'user.created': {
                const { email_addresses = [], primary_email_address_id } = evt.data;
                const primaryEmail =
                    email_addresses.find(
                        (address) =>
                            address.id === primary_email_address_id &&
                            !!address.email_address,
                    )?.email_address ?? '';
                const fallbackEmail = email_addresses?.[0]?.email_address ?? '';
                const email = primaryEmail || fallbackEmail;

                if (!email)
                    return NextResponse.json(
                        { error: 'No email provided' },
                        { status: 400 },
                    );

                user = await prisma.user.upsert({
                    where: {
                        email,
                    },
                    update: {
                        clerkUserId,
                        email,
                    },
                    create: {
                        clerkUserId,
                        email,
                    },
                });
                break;
            }
            case 'user.updated': {
                const { email_addresses = [] } = evt.data;
                const primaryEmail =
                    email_addresses.find(
                        (address) =>
                            address.id === evt.data.primary_email_address_id &&
                            !!address.email_address,
                    )?.email_address ?? '';
                const fallbackEmail = email_addresses?.[0]?.email_address ?? '';
                const email = primaryEmail || fallbackEmail;

                if (!email)
                    return NextResponse.json(
                        { error: 'No email provided' },
                        { status: 400 },
                    );

                user = await prisma.user.updateMany({
                    where: {
                        OR: [{ clerkUserId }, { email }],
                    },
                    data: {
                        clerkUserId,
                        email,
                    },
                });
                break;
            }
            case 'user.deleted': {
                user = await prisma.user.deleteMany({
                    where: {
                        clerkUserId,
                    },
                });
                break;
            }
            default:
                break;
        }

        return NextResponse.json({ user });
    } catch (error) {
        console.error('Clerk webhook error:', error);
        const message =
            error instanceof Error ? error.message : 'Unknown webhook error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
