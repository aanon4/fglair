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

class Api {

    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.access = null;
        this.expires = null;
        this.refresh = null;
    }

    async login() {
        const res = await fetch("https://user-field.aylanetworks.com/users/sign_in.json", {
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
                        app_id: 'CJIOSP-id',
                        app_secret: 'CJIOSP-Vb8MQL_lFiYQ7DKjN0eCFXznKZE'
                    }
                }
            })
        });
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors[0].message);
        }
        this.access = json.access_token;
        this.refresh = json.refresh_token;
        this.expires = Date.now() + json.expires_in * 1000;
        return this;
    }

    async token() {
        if (Date.now() > this.expires) {
            const res = await fetch("https://user-field.aylanetworks.com/users/refresh_token.json", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify({
                    refresh_token: this.refresh
                })
            });
            const json = await res.json();
            if (json.error) {
                // If refresh fails, login again
                await this.login();
            }
            else {
                this.access = json.access_token;
                this.refresh = json.refresh_token;
                this.expires = Date.now() + json.expires_in * 1000;
            }
        }
        return this.access;
    }

    async getDevices() {
        const res = await fetch("https://ads-field.aylanetworks.com/apiv1/devices.json", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `auth_token ${await this.token()}`
            }
        });
        const json = await res.json();
        console.log(json);
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
        const res = await fetch(`https://ads-field.aylanetworks.com/apiv1/dsns/${dsn}/properties.json`, {
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
        const res = await fetch("https://ads-field.aylanetworks.com/apiv1/batch_datapoints.json", {
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
