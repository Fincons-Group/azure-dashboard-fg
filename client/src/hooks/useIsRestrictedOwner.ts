import { useMsal } from "@azure/msal-react";

// "Plan Progress" and "Remove Test Cases" are still fully functional pages,
// just not ready for general use yet - only this account should be able to
// reach them (nav link and direct URL) until then.
const RESTRICTED_OWNER_EMAIL = "anderson.cahet@finconsgroup.com";

export function useIsRestrictedOwner(): boolean {
    const { instance, accounts } = useMsal();
    const activeAccount = instance.getActiveAccount() ?? accounts[0];

    return activeAccount?.username?.toLowerCase() === RESTRICTED_OWNER_EMAIL;
}
