
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
            // 失败时也把 body 解出来：worker 会把"删不掉旧备份"这类原因写在 error 里，
            // 直接吞掉的话界面上只剩一句"上传失败"，没法排查
            try {
                const detail = await response.json();
                if (detail && typeof detail === 'object') return detail;
            } catch (e) { /* body 不是 JSON 就算了 */ }
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

/** 上传备份：data 是完整备份内容（书签/分类/设置/AI/WebDAV/搜索引擎），由 BackupModal 组装。
 *  worker 会先删掉旧备份再 PUT（图床的 WebDAV PUT 不做覆盖，不删就会堆出 cloudnav_backup(1).json…），
 *  所以失败时要能把原因（例如"删除旧备份失败 HTTP 403"）带回界面。 */
export const uploadBackup = async (
    config: WebDavConfig,
    data: BackupFile
): Promise<{ ok: boolean; error?: string; replacedOld?: boolean }> => {
    const result = await callWebDavProxy('upload', config, data);
    if (result?.success === true) {
        return { ok: true, replacedOld: result.replacedOld === true };
    }
    const error = typeof result?.error === 'string' ? result.error : '';
    return { ok: false, error };
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
