export const SUPABASE_URL = "https://pvonnavvdegzorykioxw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LHptfNFDyF68-ontgXZXPw_VO6HbVjj";

export function getAuthRedirectUrl(locationLike = window.location) {
  const redirectUrl = new URL("./", locationLike.href);
  redirectUrl.search = "";
  redirectUrl.hash = "";
  return redirectUrl.href;
}
