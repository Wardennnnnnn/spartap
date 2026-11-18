'use strict';
const $ = id => document.getElementById(id);
const purpose = new URLSearchParams(location.search).get('reset') === '1' ? 'reset' : 'login';
let challenge, email, otpEnabled = false, googleEnabled = false, busy = false, resendAt = 0;
$('purpose').value = purpose;
$('password-fields').hidden = purpose !== 'reset';
$('password').required = $('confirm-password').required = purpose === 'reset';
if (purpose === 'reset') {
  document.title = 'Reset password · SparTap';
  $('login-title').textContent = 'Reset your password';
  $('intro').textContent = 'Enter your linked school email to receive a password reset code.';
  $('send').textContent = 'Send reset code';
  $('verify').textContent = 'Reset password';
  $('reset-link').hidden = true;
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}
function updateButtons() {
  const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  $('send').disabled = busy || !otpEnabled;
  $('resend').disabled = busy || !otpEnabled || seconds > 0;
  $('resend').textContent = seconds ? `Resend in ${seconds}s` : 'Resend code';
  $('change-email').disabled = busy;
  $('verify').disabled = busy;
}
function updateTheme() {
  const dark = window.SafeTapTheme?.current === 'dark';
  $('theme').querySelector('span').textContent = dark ? 'Light mode' : 'Dark mode';
  $('theme').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
}
$('theme').onclick = () => window.SafeTapTheme?.toggle();
document.addEventListener('safetap:theme', updateTheme);
updateTheme();
async function api(path, body) {
  const response = await fetch('/api/auth/' + path, {cache: 'no-store', ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
api('options').then(options => {
  googleEnabled = options.google;
  $('google-option').hidden = !googleEnabled || purpose === 'reset';
  otpEnabled = options.otp;
  $('email').placeholder = 'name@' + options.domain;
  status(otpEnabled ? 'Use the email assigned to your staff or representative account.' : 'Email codes are temporarily unavailable. Please use password sign-in.');
  updateButtons();
}).catch(error => status(error.message, true));
async function sendCode() {
  if (busy || !otpEnabled) return;
  busy = true; updateButtons(); status('Sending your code…');
  try {
    email = $('email').value.trim().toLowerCase();
    const data = await api('otp/request', {email, purpose});
    challenge = data.challenge; resendAt = Date.now() + 60000;
    $('email-form').hidden = true; $('code-form').hidden = false; $('google-option').hidden = true;
    $('login-title').textContent = purpose === 'reset' ? 'Reset your password' : 'Check your email';
    $('intro').textContent = 'Enter the 6-digit code from your school inbox. Check Spam if you don’t see it.';
    $('recipient').textContent = email;
    $('code').value = ''; $('code').focus();
    status(data.message + ' The code expires in 10 minutes.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; updateButtons(); }
}
$('email-form').onsubmit = event => { event.preventDefault(); sendCode(); };
$('resend').onclick = sendCode;
$('change-email').onclick = () => {
  challenge = null; $('code-form').hidden = true; $('email-form').hidden = false;
  $('password').value = $('confirm-password').value = '';
  $('login-title').textContent = purpose === 'reset' ? 'Reset your password' : 'Sign in with school email';
  $('intro').textContent = 'We’ll send a code to the school email linked to your SparTap account.';
  $('google-option').hidden = !googleEnabled || purpose === 'reset';
  $('email').focus(); status('Enter your linked school email.');
};
$('code-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !challenge) return;
  busy = true; updateButtons();
  try {
    if (purpose === 'reset' && $('password').value !== $('confirm-password').value) throw Error('Passwords do not match.');
    const result = await api('otp/verify', {email, challenge, purpose, code: $('code').value, ...(purpose === 'reset' ? {password: $('password').value} : {})});
    if (purpose === 'reset') {
      $('login-title').textContent = 'Password updated';
      $('intro').textContent = 'You can now sign in with your new password.';
      status(result.message); $('code-form').hidden = true;
      $('password').value = $('confirm-password').value = ''; challenge = null;
    } else location.assign('/');
  } catch (error) { status(error.message, true); }
  finally { busy = false; updateButtons(); }
};
setInterval(updateButtons, 1000);
