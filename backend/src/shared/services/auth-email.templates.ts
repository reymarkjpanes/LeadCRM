import { AUTH_SUPPORT_EMAIL, getAuthAppOrigin, getPasswordResetTtlMinutes } from '../helpers/auth-email-config';

const FONT = 'Arial, Helvetica, sans-serif';
const MUTED = '#64748b';
const BLUE = '#1264ea';
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const paragraph = (text: string, margin = '0 0 20px') => `<p style="margin:${margin};font-size:13px;line-height:1.8;color:${MUTED}">${text}</p>`;
const divider = '<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0 18px" />';

function icon(name: 'clock' | 'shield-check'): string {
  return `<img src="${escape(new URL(`/email/${name}.png`, getAuthAppOrigin()).href)}" width="12" height="12" alt="" style="display:inline-block;border:0;width:12px;height:12px;vertical-align:-1px;margin-right:6px" />`;
}

function button(url: string, label: string): string {
  // The table supplies a solid background even when Outlook ignores rounded corners.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px"><tr><td bgcolor="${BLUE}" style="border-radius:6px;text-align:center;mso-padding-alt:12px 22px"><a href="${escape(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-family:${FONT};font-size:13px;font-weight:bold;line-height:18px;text-decoration:none;border-radius:6px">${label}<span aria-hidden="true" style="padding-left:16px">&#8599;</span></a></td></tr></table>`;
}

function securityNotice(title: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:#f2f6fd;border-left:2px solid #e2e8f0"><tr><td style="padding:14px 16px"><p style="margin:0 0 6px;font-size:13px;font-weight:bold;line-height:1.5;color:#1e293b">${icon('shield-check')}${title}</p><p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED}">${text}</p></td></tr></table>`;
}

function wrapAuthEmail(title: string, body: string, footerNote: string): string {
  const appOrigin = getAuthAppOrigin();
  const linkStyle = `color:${BLUE};text-decoration:underline;overflow-wrap:anywhere;word-break:break-all`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><title>${escape(title)} | LeadCRM</title>
<!--[if mso]><xml><o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office"><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>body{margin:0;padding:0}table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}a:focus-visible{outline:2px solid #1264ea;outline-offset:3px}@media only screen and (max-width:480px){.auth-body{padding:18px 20px 30px!important}.auth-footer{padding:24px 18px!important}.auth-title{font-size:27px!important}}</style></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT};color:#0f172a;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tr><td align="center">
<!--[if mso]><table role="presentation" width="512" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:512px;table-layout:fixed;background:#ffffff">
<tr><td align="center" style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
<a href="${escape(new URL('/login', appOrigin).href)}" style="text-decoration:none;color:#0f172a"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="50" style="padding-right:6px"><img src="${escape(new URL('/leadcrm_logo.png', appOrigin).href)}" width="50" height="50" alt="LeadCRM logo" style="display:block;border:0;width:50px;height:50px" /></td><td align="left"><p style="margin:0;font-size:24px;line-height:1.2;font-weight:bold;color:#0f172a">Lead<span style="color:${BLUE}">CRM</span></p><p style="margin:6px 0 0;font-size:11px;color:${MUTED};line-height:1.4">Camxian Technologies</p></td></tr></table></a>
</td></tr>
<tr><td class="auth-body" style="padding:18px 24px 30px;font-family:${FONT};overflow-wrap:anywhere">
<h1 class="auth-title" style="margin:0 0 24px;color:#0f172a;font-size:28px;font-weight:bold;line-height:1.2">${escape(title)}</h1>${body}
</td></tr>
<tr><td class="auth-footer" align="center" bgcolor="#f2f6fd" style="padding:24px 24px 18px;border-top:1px solid #e2e8f0;font-family:${FONT}">
<p style="margin:0 0 14px;font-size:11px;line-height:1.8;color:${MUTED}"><a href="${escape(new URL('/privacy-policy', appOrigin).href)}" style="${linkStyle}">Privacy Policy</a> &nbsp;|&nbsp; <a href="${escape(new URL('/terms-of-service', appOrigin).href)}" style="${linkStyle}">Terms of Service</a> &nbsp;|&nbsp; <a href="${escape(new URL('/help', appOrigin).href)}" style="${linkStyle}">Help Center</a></p>
<p style="margin:0 0 18px;font-size:11px;color:${MUTED};line-height:1.7">Need a hand? <a href="mailto:${AUTH_SUPPORT_EMAIL}" style="color:${BLUE};text-decoration:none">${AUTH_SUPPORT_EMAIL}</a></p>
<p style="margin:0 0 10px;font-size:10px;line-height:1.7;color:${MUTED}">${escape(footerNote)}</p>
<p style="margin:0;font-size:11px;line-height:1.7;color:${MUTED}">&copy; ${new Date().getFullYear()} LeadCRM &middot; Camxian Technologies</p>
<p style="margin:6px 0 0;font-size:10px;line-height:1.7;color:${MUTED}">Developed by LeadCRM Development Team</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

export function buildPasswordResetEmail(resetUrl: string, firstName = 'there'): string {
  let url: URL;
  try { url = new URL(resetUrl); } catch { throw new Error('Invalid password reset destination.'); }
  if (url.origin !== getAuthAppOrigin() || url.pathname !== '/reset-password' ||
      !url.searchParams.get('token') || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length !== 1) {
    throw new Error('Invalid password reset destination.');
  }
  const minutes = getPasswordResetTtlMinutes();
  return wrapAuthEmail('Reset your password', `
<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#1e293b">Hi ${escape(firstName.trim() || 'there')},</p>
${paragraph('We received a request to reset the password for your LeadCRM account. Select the button below to choose a new password.')}
${button(url.href, 'Reset password')}
<p style="margin:0;font-size:11px;line-height:1.8;color:${MUTED}">${icon('clock')}This link expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.</p>
${divider}
${paragraph('Or copy and paste this link into your browser:', '0 0 8px')}
<p style="margin:0;font-size:12px;line-height:1.8;word-break:break-all;overflow-wrap:anywhere"><a href="${escape(url.href)}" style="color:${BLUE};text-decoration:underline;word-break:break-all">${escape(url.href)}</a></p>
${securityNotice("Didn't request this?", "You can safely ignore this email. Your password will stay unchanged. If you're concerned about your account, please contact our support team.")}
${paragraph('All the best,<br /><strong style="color:#1e293b">The LeadCRM team</strong>', '26px 0 0')}
`, "You're receiving this email because a password reset was requested for your account.");
}

/** Plaintext credentials are retained only in the existing outgoing welcome flow. */
export function buildWelcomeCredentialsEmail(user: { firstName: string; lastName: string; email: string }, temporaryPassword: string): string {
  const loginUrl = new URL('/login', getAuthAppOrigin()).href;
  return wrapAuthEmail('Welcome to LeadCRM', `
<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#1e293b">Hi ${escape(user.firstName.trim() || 'there')},</p>
${paragraph("Your LeadCRM account has been created. We're happy to have you on board — your workspace is ready when you are.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:#f2f6fd;border:1px solid #e2e8f0;border-radius:6px;table-layout:fixed;border-collapse:separate;border-spacing:0"><tr><td style="padding:18px 20px;font-size:13px;line-height:1.5;color:#1e293b;overflow-wrap:anywhere;word-break:break-word">
<p style="margin:0 0 18px"><strong>Email:</strong><br /><a href="mailto:${escape(user.email)}" style="color:${BLUE};text-decoration:underline;word-break:break-all">${escape(user.email)}</a></p>
<p style="margin:0"><strong>Temporary Password:</strong><br /><span style="font-family:monospace;font-size:16px;overflow-wrap:anywhere;word-break:break-all">${escape(temporaryPassword)}</span></p>
</td></tr></table>
${paragraph("For your security, you'll create a new password the first time you sign in. Then we'll introduce you to your workspace.")}
${button(loginUrl, 'Log in to LeadCRM')}
${divider}
${paragraph('You can also sign in at:', '0 0 8px')}
<p style="margin:0;font-size:12px;line-height:1.8;word-break:break-all"><a href="${escape(loginUrl)}" style="color:${BLUE};text-decoration:underline">${escape(loginUrl)}</a></p>
${securityNotice('Keep your account secure', "Keep your temporary password private and don't share it with anyone. Your new password should be unique to your LeadCRM account.")}
${paragraph('See you inside,<br /><strong style="color:#1e293b">The LeadCRM team</strong>', '26px 0 0')}
`, "You're receiving this email because an administrator created your LeadCRM account.");
}
