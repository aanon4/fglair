// https://github.com/jonathangreen/homebridge-fglair

const fetch = require("node-fetch");

const OPERATION_MODE_V2N = {
    0: "off",
    1: "turning_on",
    2: "auto",
    3: "cool",
    4: "dry",
    5: "fan",
    6: "heat"
};
const OPERATION_MODE_N2V = {
    "off": 0,
    "turning_on": 1,
    "auto": 2,
    "cool": 3,
    "dry": 4,
    "fan": 5,
    "heat": 6
};
const FAN_SPEED_V2N = {
    0: "quiet",
    1: "low",
    2: "medium",
    3: "high",
    4: "auto"
};
const FAN_SPEED_N2V = {
    "quiet": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "auto": 4
};
const TARGETS = [
    { login: "user-field-eu.aylanetworks.com", base: "ads-field-eu.aylanetworks.com", id: "FGLair-eu-id",      secret: "FGLair-eu-gpFbVBRoiJ8E3QWJ-QRULLL3j3U" },
    { login: "user-field.aylanetworks.com",    base: "ads-field.aylanetworks.com",    id: "CJIOSP-id",         secret: "CJIOSP-Vb8MQL_lFiYQ7DKjN0eCFXznKZE" },
    { login: "user-field.ayla.com.cn",         base: "ads-field.ayla.com.cn",         id: "FGLairField-cn-id", secret: "FGLairField-cn-zezg7Y60YpAvy3HPwxvWLnd4Oh4" }
];

class Api {

    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.access = null;
        this.expires = null;
        this.refresh = null;
        this.target = null;
    }

    async login() {
        let json = null;
        for (let t = 0; t < TARGETS.length; t++) {
            const target = TARGETS[t];
            const res = await fetch(`https://${target.login}/users/sign_in.json`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify({
                    user: {
                        email: this.username,
                        password: this.password,
                        application: {
                            app_id: target.id,
                            app_secret: target.secret
                        }
                    }
                })
            });
            json = await res.json();
            if (!json.error) {
                this.target = target;
                break;
            }
        }
        if (json.error) {
            throw new Error(json.error);
        }
        this.access = json.access_token;
        this.refresh = json.refresh_token;
        this.expires = Date.now() + json.expires_in * 1000;
        return this;
    }

    async token() {
        if (Date.now() > this.expires) {
            const res = await fetch(`https://${this.target.login}/users/refresh_token.json`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify({
                    user: {
                        refresh_token: this.refresh
                    }
                })
            });
            let json = await res.json();
            if (json.error) {
                // If refresh fails, login again
                const res = await fetch(`https://${this.target.login}/users/sign_in.json`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify({
                        user: {
                            email: this.username,
                            password: this.password,
                            application: {
                                app_id: this.target.id,
                                app_secret: this.target.secret
                            }
                        }
                    })
                });
                json = await res.json();
                if (json.error) {
                    throw new Error(json.error)
                }
            }
            this.access = json.access_token;
            this.refresh = json.refresh_token;
            this.expires = Date.now() + json.expires_in * 1000;
        }
        return this.access;
    }

    async getDevices() {
        const res = await fetch(`https://${this.target.base}/apiv1/devices.json`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            }
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        const devices = [];
        for (const device of json) {
            devices.push(device.device);
        }
        return devices;
    }

    async _getDeviceProperties(dsn) {
        const res = await fetch(`https://${this.target.base}/apiv1/dsns/${dsn}/properties.json`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            }
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        const properties = {};
        for (let i = 0; i < json.length; i++) {
            const p = json[i].property;
            if (p) {
                properties[p.name] = p;
            }
        }
        return properties;
    }

    async _setDeviceProperties(properties) {
        const res = await fetch(`https://${this.target.base}/apiv1/batch_datapoints.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            },
            body: JSON.stringify({
                batch_datapoints: properties
            })
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        return json;
    }

    async _getDeviceProperty(propkey) {
        const res = await fetch(`https://${this.target.base}/apiv1/properties/${propkey}/datapoints.json`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            }
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        return json;
    }

    async _setDeviceProperty(propkey, value) {
        const res = await fetch(`https://${this.target.base}/apiv1/properties/${propkey}/datapoints.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            },
            body: JSON.stringify({
                datapoint: {
                    value: `${value}`
                }
            })
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        return json;
    }

    async update(dsn) {
        const props = await this._getDeviceProperties(dsn);
        return await this._setDeviceProperty(props.refresh.key, 1);
    }

    async getDeviceState(dsn) {
        const props = await this._getDeviceProperties(dsn);
        return {
            mode: OPERATION_MODE_V2N[props.operation_mode.value],
            fanSpeed: FAN_SPEED_V2N[props.fan_speed.value],
            currentTemperatureC: props.display_temperature.value / 100 - 50,
            targetTemperatureC: props.adjust_temperature.value / 10
        };
    }

    async setDeviceState(dsn, states) {
        const properties = [];
        for (let name in states) {
            const value = states[name];
            switch (name) {
                case "mode":
                    properties.push({
                        dsn: dsn,
                        name: "operation_mode",
                        datapoint: {
                            value: OPERATION_MODE_N2V[value]
                        }
                    });
                    break;
                case "fanSpeed":
                    properties.push({
                        dsn: dsn,
                        name: "fan_speed",
                        datapoint: {
                            value: FAN_SPEED_N2V[value]
                        }
                    });
                    break;
                case "targetTemperatureC":
                    properties.push({
                        dsn: dsn,
                        name: "adjust_temperature",
                        datapoint: {
                            value: Math.round(value * 2) * 5
                        }
                    });
                    break;
                case "currentTemperatureC":
                default:
                    break;
            }
        }
        if (properties.length) {
            await this._setDeviceProperties(properties);
        }
    }
}

module.exports = async function connect(username, password) {
    const api = new Api(username, password);
    return await api.login();
};
