import {
    auth,
    clerkClient,
    currentUser,
    redirectToSignIn,
} from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';

import { prisma } from './prisma-client';

type SyncedUserIdentity = {
    clerkUserId: string;
    email: string;
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

    // Fallback to Clerk Backend API when currentUser() has no email in this request context.
    const user = await clerkClient.users.getUser(clerkUserId);
    const primaryFromApi =
        user.emailAddresses.find(
            (address) =>
                address.id === user.primaryEmailAddressId &&
                !!address.emailAddress,
        )?.emailAddress ?? '';
    const fallbackFromApi = user.emailAddresses?.[0]?.emailAddress ?? '';
    const emailFromApi = primaryFromApi || fallbackFromApi;
    if (!emailFromApi) return null;

    return { clerkUserId, email: emailFromApi } satisfies SyncedUserIdentity;
}

export async function syncSignedInUserToDatabase(include?: Prisma.UserInclude) {
    const { userId } = auth();
    if (!userId) return null;

    const identity = await getClerkIdentity(userId);
    if (!identity) return null;

    return prisma.user.upsert({
        where: {
            email: identity.email,
        },
        update: {
            clerkUserId: identity.clerkUserId,
            email: identity.email,
        },
        create: {
            clerkUserId: identity.clerkUserId,
            email: identity.email,
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
    if (!userId) return redirectToSignIn();

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
