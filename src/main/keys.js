import keytar from 'keytar';

const SERVICE = 'workspace-dashboard';
const ACCOUNT = 'anthropic-api-key';
const SYNC_ACCOUNT = 'sync-token';
const PUBLISH_ACCOUNT = 'ideas-publish-token';

export async function getAIKey() {
  try {
    return await keytar.getPassword(SERVICE, ACCOUNT);
  } catch {
    return null;
  }
}

export async function setAIKey(key) {
  try {
    if (key) {
      await keytar.setPassword(SERVICE, ACCOUNT, key);
    } else {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    }
    return true;
  } catch {
    return false;
  }
}

export async function getSyncToken() {
  try {
    return await keytar.getPassword(SERVICE, SYNC_ACCOUNT) || '';
  } catch {
    return '';
  }
}

export async function setSyncToken(token) {
  try {
    if (token) {
      await keytar.setPassword(SERVICE, SYNC_ACCOUNT, token);
    } else {
      await keytar.deletePassword(SERVICE, SYNC_ACCOUNT);
    }
    return true;
  } catch {
    return false;
  }
}

export async function getPublishToken() {
  try {
    return await keytar.getPassword(SERVICE, PUBLISH_ACCOUNT) || '';
  } catch {
    return '';
  }
}

export async function setPublishToken(token) {
  try {
    if (token) {
      await keytar.setPassword(SERVICE, PUBLISH_ACCOUNT, token);
    } else {
      await keytar.deletePassword(SERVICE, PUBLISH_ACCOUNT);
    }
    return true;
  } catch {
    return false;
  }
}
