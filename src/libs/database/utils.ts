import {
    auth,
    currentUser,
} from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';

import { prisma } from './prisma-client';

type SyncedUserIdentity = {
    clerkUserId: string;
    email: string | null;
};

async function getClerkIdentity(clerkUserId: string) {
    const fromSession = await currentUser();
    const primaryFromSession =
        fromSession?.emailAddresses.find(
            (address) =>
                address.id === fromSession?.primaryEmailAddressId &&
                !!address.emailAddress,
        )?.emailAddress ?? '';
    const fallbackFromSession =
        fromSession?.emailAddresses?.[0]?.emailAddress ?? '';
    const emailFromSession = primaryFromSession || fallbackFromSession;
    if (emailFromSession) {
        return { clerkUserId, email: emailFromSession } satisfies SyncedUserIdentity;
    }

    // Fallback to session claims when currentUser() has no email.
    const { sessionClaims } = auth();
    const emailFromClaims =
        (sessionClaims?.email as string | undefined) ||
        (sessionClaims?.primaryEmailAddress as string | undefined) ||
        '';
    return {
        clerkUserId,
        email: emailFromClaims || null,
    } satisfies SyncedUserIdentity;
}

export async function syncSignedInUserToDatabase(include?: Prisma.UserInclude) {
    const { userId } = auth();
    if (!userId) return null;

    const identity = await getClerkIdentity(userId);
    if (!identity) return null;

    // Fallback for cases where Clerk context does not expose email in this request.
    // Guarantees a synced DB row keyed by clerkUserId.
    const fallbackEmail = `clerk+${identity.clerkUserId}@local.invalid`;
    const resolvedEmail = identity.email || fallbackEmail;

    // If we have a real email and a row already exists under that email, link it.
    if (identity.email) {
        const existingByEmail = await prisma.user.findUnique({
            where: { email: identity.email },
        });
        if (existingByEmail && existingByEmail.clerkUserId !== identity.clerkUserId) {
            return prisma.user.update({
                where: { id: existingByEmail.id },
                data: { clerkUserId: identity.clerkUserId, email: identity.email },
                include,
            });
        }
    }

    return prisma.user.upsert({
        where: {
            clerkUserId: identity.clerkUserId,
        },
        update: {
            ...(identity.email ? { email: identity.email } : {}),
        },
        create: {
            clerkUserId: identity.clerkUserId,
            email: resolvedEmail,
        },
        include,
    });
}

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

    return syncSignedInUserToDatabase(include);
}

// Checks that the user is signed in and returns the user from the database that matches the Clerk user ID, or throws an error if not.
export async function getSignedInUserOrThrow(include?: Prisma.UserInclude) {
    const { userId } = auth();
    if (!userId) throw new Error('User not signed in');

    const user = await getSignedInUser(include);
    if (!user) throw new Error('User not found in database');

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
