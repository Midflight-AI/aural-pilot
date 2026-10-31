/** Fail closed if a preview accidentally inherits the baseline production database. */
export function isolatedVideoDatabase(url: string | undefined, expectedRef: string | undefined): boolean {
 if(!expectedRef || !/^[a-z]{20}$/.test(expectedRef) || ["knbbkrfatygusjqjcjcy","eaamqnakereqidmaxwvp"].includes(expectedRef)) return false;
 return url === `https://${expectedRef}.supabase.co`;
}
