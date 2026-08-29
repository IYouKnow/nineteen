const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const getAppParamValue = (paramName, { defaultValue } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (searchParam && defaultValue) {
		storage.setItem(paramName, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(paramName, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(paramName);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_APP_ID }),
		token: getAppParamValue("access_token", { defaultValue: import.meta.env.VITE_APP_TOKEN }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
	};
}

export const appParams = {
	...getAppParams()
}
