
import { BackupFile, WebDavConfig } from "../types";

// 站点访问密码（解锁后存在 localStorage），/api/webdav 和别的接口一样要求这个鉴权头
const AUTH_TOKEN_KEY = 'cloudnav_auth_token';
const getAuthToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || '';

// Helper to call our Cloudflare Proxy
// This solves the CORS issue by delegating the request to the backend
const callWebDavProxy = async (operation: 'check' | 'upload' | 'download', config: WebDavConfig, payload?: any) => {
    try {
        const response = await fetch('/api/webdav', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': getAuthToken(),
            },
            body: JSON.stringify({
                operation,
                config,
                payload
            })
        });
        
        if (!response.ok) {
            console.error(`WebDAV Proxy Error: ${response.status}`);
            return null;
        }
        
        return await response.json();
    } catch (e) {
        console.error("WebDAV Proxy Network Error", e);
        return null;
    }
}

export const checkWebDavConnection = async (config: WebDavConfig): Promise<boolean> => {
    if (!config.url || !config.username || !config.password) return false;
    const result = await callWebDavProxy('check', config);
    return result?.success === true;
};

/** 上传备份：data 是完整备份内容（书签/分类/设置/AI/WebDAV/搜索引擎），由 BackupModal 组装 */
export const uploadBackup = async (config: WebDavConfig, data: BackupFile): Promise<boolean> => {
    const result = await callWebDavProxy('upload', config, data);
    return result?.success === true;
};

/** 下载备份。老备份文件里只有 links/categories，属于正常情况（返回对象缺的字段由调用方按"未提供"处理）。 */
export const downloadBackup = async (config: WebDavConfig): Promise<BackupFile | null> => {
    const result = await callWebDavProxy('download', config);
    
    // Check if the result looks like valid backup data
    if (result && Array.isArray(result.links) && Array.isArray(result.categories)) {
        return result as BackupFile;
    }
    return null;
};
