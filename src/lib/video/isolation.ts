/** Fail closed if a preview accidentally inherits the baseline production database. */
export function isolatedVideoDatabase(url: string | undefined, expectedRef: string | undefined): boolean {
 if(!expectedRef || !/^[a-z]{20}$/.test(expectedRef) || ["knbbkrfatygusjqjcjcy","eaamqnakereqidmaxwvp"].includes(expectedRef)) return false;
 return url === `https://${expectedRef}.supabase.co`;
}

/** Production activation is explicit and must match the Aural database, never Ramp. */
export function videoDatabaseAllowed(url:string|undefined,expectedRef:string|undefined,environment:string|undefined):boolean {
 if(environment==="preview") return isolatedVideoDatabase(url,expectedRef);
 return environment==="production" && expectedRef==="knbbkrfatygusjqjcjcy" && url==="https://knbbkrfatygusjqjcjcy.supabase.co";
}
