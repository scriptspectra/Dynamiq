import { auth, currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';

import { prisma } from './prisma-client';

// Checks that the user is signed in and returns the user from the database that matches the Clerk user ID.
export async function getSignedInUser(include?: Prisma.UserInclude) {
    // Get the signed in user ID from Clerk
    const authdata = auth();
    const { userId } = authdata;
    if (!userId) return null;

    // Fast path: user already synced in our database.
    const existingUser = await prisma.user.findUnique({
        where: {
            clerkUserId: userId,
        },
        include,
    });
    if (existingUser) return existingUser;

    // Webhook-independent sync path:
    // if webhook delivery fails, lazily create/link the user on first request.
    const clerkUser = await currentUser();
    const primaryEmail =
        clerkUser?.emailAddresses.find(
            (address) =>
                address.id === clerkUser?.primaryEmailAddressId &&
                !!address.emailAddress,
        )?.emailAddress ?? '';
    const fallbackEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? '';
    const email = primaryEmail || fallbackEmail;
    if (!email) return null;

    return prisma.user.upsert({
        where: {
            email,
        },
        update: {
            clerkUserId: userId,
            email,
        },
        create: {
            clerkUserId: userId,
            email,
        },
        include,
    });
}

// Checks that the user is signed in and returns the user from the database that matches the Clerk user ID, or throws an error if not.
export async function getSignedInUserOrThrow(include?: Prisma.UserInclude) {
    const user = await getSignedInUser(include);
    if (!user) throw new Error('User not signed in');

    return user;
}

// Checks that all the given parameters are defined, and throws an error if not.
export function checkParamsOrThrow(
    params?: Record<string, any>,
    paramsList: string[] = [],
) {
    paramsList.forEach((param) => {
        if (
            !params?.[param] &&
            params?.[param] !== false &&
            params?.[param] !== 0
        ) {
            throw new Error(`Missing parameter: ${param}`);
        }
    });
}

// Combines the checkParamsOrThrow and getSignedInUserOrThrow functions. Returns the signed in user.
export function checkParamsAndGetUserOrThrow(
    params?: Record<string, any>,
    paramsList: string[] = [],
) {
    checkParamsOrThrow(params, paramsList);
    return getSignedInUserOrThrow();
}
