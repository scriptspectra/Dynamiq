import { CURRENCIES } from '@/libs/database';
import { updateUser } from '@/libs/database/functions/user';
import { syncSignedInUserToDatabase } from '@/libs/database/utils';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// User update schema
const userUpdateSchema = z.object({
    defaultCurrency: z.enum([CURRENCIES[0], ...CURRENCIES.slice(1)]).optional(),
});

// Update the signed in user - we dont need the user id, as it will be fetched from the session
export async function PUT(req: Request) {
    try {
        const body = await req.json();

        // Validate the request body
        const userData = userUpdateSchema.parse(body);

        // Update the user
        const queryResponse = await updateUser(userData);

        return NextResponse.json(queryResponse);
    } catch (error) {
        return NextResponse.json({ error }, { status: 500 });
    }
}

// Sync signed-in Clerk user into database and return user record.
export async function GET() {
    try {
        const { userId } = auth();
        const clerkUser = await currentUser();
        const user = await syncSignedInUserToDatabase();
        if (!user) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'Sync failed: no signed-in Clerk user detected',
                    debug: {
                        userId: userId ?? null,
                        clerkPrimaryEmailId:
                            clerkUser?.primaryEmailAddressId ?? null,
                        clerkEmailCount: clerkUser?.emailAddresses?.length ?? 0,
                        targetTable: 'public."User"',
                    },
                },
                { status: 401 },
            );
        }

        return NextResponse.json({
            ok: true,
            user,
            debug: {
                userId,
                targetTable: 'public."User"',
            },
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Failed to sync user';
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
