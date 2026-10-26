// Keep public posting IDs stable when an employer changes its board slug.
export function greenhouseBoardToken(token) {
  return token === "hubspot" ? "hubspotjobs" : token;
}
