module.exports = {
    dependency: {
        platforms: {
            kepler: {
                "autolink": {
                    "KeepAwake": {
                      "libraryName": "libKeepAwake.so",
                      "linkDynamic": true,
                      "provider": "application",
                      "components": [],
                      "turbomodules": [
                        "KeepAwake"
                      ]
                    }
                }
            },
        },
    },
};