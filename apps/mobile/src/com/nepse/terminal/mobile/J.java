package com.nepse.terminal.mobile;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * JSONObject with unchecked put() overloads.
 *
 * The Android org.json API declares JSONException on every put(), which forces
 * checked-exception noise through every response builder even though the
 * values we store are always JSON-safe. This subclass is used only to build
 * responses; parsing still uses JSONObject and catches JSONException.
 */
final class J extends JSONObject {

    J() {
        super();
    }

    /** Defensive copy of a parsed object; never mutates the source. */
    static JSONObject copy(JSONObject value) {
        try {
            return new JSONObject(value.toString());
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
    }

    @Override
    public J put(String name, Object value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }

    @Override
    public J put(String name, boolean value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }

    @Override
    public J put(String name, double value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }

    @Override
    public J put(String name, int value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }

    @Override
    public J put(String name, long value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }

    @Override
    public J putOpt(String name, Object value) {
        try {
            super.putOpt(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error.getMessage(), error);
        }
        return this;
    }
}
