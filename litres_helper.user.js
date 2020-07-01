// ==UserScript==
// @name         LitRes Helper
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  LitRes Helper
// @author       alezhu
// @match        https://www.litres.ru/*
// @grant        none
// @run-at      document-start
// ==/UserScript==

(function(global) {
    "use strict";
    var $;
    var indexedDB = global.indexedDB;
    var _CORE_INSTANCE;
    var orig_onPageLoad;
    const _LITRES_HELPER_SETTINGS = "LITRES_HELPER_SETTINGS";
    const DATA_IGNORED = "ignored";
    const TEXT_SHOW = "Показать";
    const TEXT_HIDE = "Скрыть";

    var DB = (function() {
        const _LITRES_HELPER_DB = "LITRES_HELPER_DB";
        const _LITRES_HELPER_STOR_IGNORED = "ignored";
        const _LITRES_HELPER_STOR_INDEX_VALUE = "value";

        function DB() {
            this._DB = null;
            this._IgnoredSet = null;
        }

        DB.prototype.openAsync = function() {
            var self = this;
            if (this._DB) {
                return Promise.resolve(this._DB);
            }
            return new Promise(function(resolve, reject) {
                var openReq = indexedDB.open(_LITRES_HELPER_DB, 1);
                openReq.onupgradeneeded = function(event) {
                    let db = openReq.result;
                    if (event.oldVersion < 1) {
                        // выполнить инициализацию
                        var store = db.createObjectStore(_LITRES_HELPER_STOR_IGNORED, {
                            autoIncrement: true,
                        });
                        store.createIndex(_LITRES_HELPER_STOR_INDEX_VALUE, "", {
                            unique: true,
                        });
                    }
                    if (event.oldVersion < 2) {
                        //TODO
                    }
                };
                openReq.onsuccess = function() {
                    var db = openReq.result;
                    db.onversionchange = function() {
                        db.close();
                        global.location.reload();
                    };
                    resolve(openReq.result);
                };
                openReq.onerror = function() {
                    reject(openReq.error);
                };
            }).then(function(db) {
                self._DB = db;
                return db;
            });
        };
        DB.prototype._getIgnoredStoreAsync = function(read_write) {
            return this.openAsync().then(function(db) {
                return db
                    .transaction(
                        [_LITRES_HELPER_STOR_IGNORED],
                        read_write ? "readwrite" : "readonly"
                    )
                    .objectStore(_LITRES_HELPER_STOR_IGNORED);
            });
        };
        DB.prototype.getIgnoredSetAsync = function() {
            var self = this;
            if (this._IgnoredSet) {
                return new Promise.resolve(this._IgnoredSet);
            }
            return new Promise(function(resolve, reject) {
                self._getIgnoredStoreAsync().then(function(store) {
                    self._IgnoredSet = new Set();
                    var cursorReq = store.openCursor();
                    cursorReq.onsuccess = function(e) {
                        var cursor = e.target.result;
                        if (cursor) {
                            self._IgnoredSet.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(self._IgnoredSet);
                        }
                    };
                    cursorReq.onerror = function() {
                        reject(cursorReq.error);
                    };
                });
            });
        };

        DB.prototype.isIgnoredAsync = function(value) {
            var self = this;
            if (this._IgnoredSet) {
                return Promise.resolve(this._IgnoredSet.has(value));
            }
            return new Promise(function(resolve, reject) {
                self._getIgnoredStoreAsync().then(function(store) {
                    var index = store.index(_LITRES_HELPER_STOR_INDEX_VALUE);
                    var indexReq = index.get(value);
                    indexReq.onsuccess = function(e) {
                        resolve(!!this.result);
                    };
                    indexReq.onerror = function() {
                        resolve(false);
                    };
                });
            });
        };

        DB.prototype.filterIgnoredAsync = function(values) {
            var self = this;
            if (this._IgnoredSet) {
                var result = [];
                for (var i = 0; i < values.length; ++i) {
                    var value = values[i];
                    if (this._IgnoredSet.has(value)) {
                        result.push(value);
                    }
                }
                return Promise.resolve(result);
            }
            return new Promise(function(resolve, reject) {
                self._getIgnoredStoreAsync().then(function(store) {
                    var index = store.index(_LITRES_HELPER_STOR_INDEX_VALUE);
                    var result = [];
                    for (var i = 0; i < values.length; ++i) {
                        result.push(
                            (function(value) {
                                return new Promise(function(resolve) {
                                    var indexReq = index.get(value);
                                    indexReq.onsuccess = function(e) {
                                        resolve(!!this.result);
                                    };
                                    indexReq.onerror = function() {
                                        resolve(false);
                                    };
                                });
                            })(values[i])
                        );
                    }
                    Promise.all(result).then(function(results) {
                        var ignored = [];
                        for (var i = 0; i < values.length; ++i) {
                            if (results[i]) {
                                ignored.push(values[i]);
                            }
                        }
                        resolve(ignored);
                    });
                });
            });
        };

        DB.prototype.addToIgnore = function(values) {
            var self = this;
            if (!Array.isArray(values)) {
                values = [values];
            }
            this._getIgnoredStoreAsync(true).then(function(store) {
                for (var i = 0; i < values.length; ++i) {
                    var value = values[i];
                    if (self._IgnoredSet) {
                        self._IgnoredSet.add(value);
                    }
                    store.put(value);
                }
            });
        };

        DB.prototype.removeFromIgnore = function(values) {
            var self = this;
            if (!Array.isArray(values)) {
                values = [values];
            }
            this._getIgnoredStoreAsync(true).then(function(store) {
                var index = store.index(_LITRES_HELPER_STOR_INDEX_VALUE);
                for (var i = 0; i < values.length; ++i) {
                    (function(value) {
                        var keyReq = index.getKey(value);
                        keyReq.onsuccess = function() {
                            var deleteReq = store.delete(keyReq.result);
                            if (self._IgnoredSet) {
                                deleteReq.onsuccess = function() {
                                    self._IgnoredSet.remove(value);
                                };
                            }
                        };
                    })(values[i]);
                }
            });
        };

        return DB;
    })();

    var Settings = {
        init: function() {
            var str = localStorage.getItem(_LITRES_HELPER_SETTINGS);
            if (str) {
                var temp = JSON.parse(str);
                Object.assign(this, temp);
            }
        },
        save: function() {
            var str = JSON.stringify(this);
            localStorage.setItem(_LITRES_HELPER_SETTINGS, str);
        },
    };

    Object.defineProperty(Settings, "hideOrShowOwned", {
        get: function() {
            if (!this._hideOrShowOwned) {
                this.hideOrShowOwned = "h";
            }
            return this._hideOrShowOwned;
        },

        set: function(value) {
            if (this._hideOrShowOwned == value) return;
            this._hideOrShowOwned = value;
            this.save();
        },
    });

    Object.defineProperty(Settings, "showIgnored", {
        get: function() {
            return this._showIgnored;
        },

        set: function(value) {
            if (this._showIgnored == value) return;
            this._showIgnored = value;
            this.save();
        },
    });

    function filterArts(pageNode, arts) {
        var result = [];
        for (var i = 0; i < arts.length; ++i) {
            var art = arts[i];
            var jArt = $(art);
            var jA = jArt.find("a[data-available]");
            var owned = jA.data("purchased");
            if (owned) {
                if (Settings.hideOrShowOwned == "h") {
                    continue;
                }
            }
            result.push(art);
        }
        return result;
    }

    function filterArtsAsync(pageNode, arts) {
        var result = filterArts(pageNode, arts);

        if (!result.length) return Promise.resolve(result);
        return new Promise(function(resolve, reject) {

            var idMap = new Map();
            for (var i = 0; i < result.length; ++i) {
                var art = result[i];
                var jArt = $(art);
                var jId = jArt.find("a[data-art]");
                var id = jId.data("art");
                var purchased = jId.data("purchased");
                var jIgnoreBtn = null;
                if (!purchased) {
                    jIgnoreBtn = $('<span class="price-label take-label" style="top: 5px; bottom: unset;">' + TEXT_HIDE + '</span>')
                        .data("id", id)
                        .data(DATA_IGNORED, false)
                        .click(function(event) {
                            event.stopPropagation();
                            var jThis = $(this);
                            var id = jThis.data("id");
                            var ignored = jThis.data(DATA_IGNORED);
                            var db = new DB();
                            if (ignored) {
                                db.removeFromIgnore(id);
                            } else {
                                db.addToIgnore(id);
                            }
                            ignored = !ignored;
                            jThis.text(ignored ? TEXT_SHOW : TEXT_HIDE).data(DATA_IGNORED, ignored);
                            //global.location.reload();                        
                        });

                    jArt.append(jIgnoreBtn);
                }
                idMap.set(id, {
                    art: art,
                    jArt: jArt,
                    purchased: purchased,
                    jIgnoreBtn: jIgnoreBtn
                });
            }

            var db = new DB();

            var ids = Array.from(idMap.keys());
            db.filterIgnoredAsync(ids).then(function(ignoredIds) {
                var showIgnored = Settings.showIgnored;
                for (var i = 0; i < ignoredIds.length; ++i) {
                    var ignoreId = ignoredIds[i];
                    var artInfo = idMap.get(ignoreId);
                    if (!artInfo.purchased) {
                        if (showIgnored) {
                            if (artInfo.jIgnoreBtn) {
                                artInfo.jIgnoreBtn.text(TEXT_SHOW).data(DATA_IGNORED, true);
                            }
                        } else {
                            idMap.delete(ignoreId);
                        }
                    }
                }
                var result = Array.from(idMap.values()).map(function(value) {
                    return value.art;
                })
                resolve(result);

            })
        });
    }

    var style = [
        "padding: 1rem;",
        "background: linear-gradient( black, orangered);",
        "font-weight:bold;",
        "border-radius:0.5rem;",
        "color: white;",
    ].join("");

    function start_banner() {
        console.log("%c%s", style, "LitRes Helper activated");
    }

    function start_book() {
        if ("$" in global) {
            start_banner();
            $ = global.$;
            var book = global.litres.page.biblio_book.art;
            if (!book.purchased) {
                var jActions = $("div.biblio_book_actions");

                var jIgnore = $('<div class="biblio_book_actions_flex"><span class="coolbtn border-gray action_read button_high light_actions ">' + TEXT_HIDE + '</span></div>').data(DATA_IGNORED, false).click(function(event) {
                    var jThis = $(this);
                    var ignored = jThis.data(DATA_IGNORED);
                    var db = new DB();
                    if (ignored) {
                        db.removeFromIgnore(book.id);
                    } else {
                        db.addToIgnore(book.id);
                    }
                    ignored = !ignored;
                    jThis.data(DATA_IGNORED, ignored).children().first().text(ignored ? TEXT_SHOW : TEXT_HIDE);
                });
                jActions.append(jIgnore);

                var db = new DB();
                db.isIgnoredAsync(book.id).then(function(ignored) {
                    if (ignored) {
                        jIgnore.data(DATA_IGNORED, ignored).children().first().text(TEXT_SHOW);
                    }
                });
            }

            return;
        }
        setTimeout(start_book, 1);
    }

    function start_collection() {
        if ("require" in global) {
            global.require(["MGrid_Core"], function(Core) {
                start_banner();
                $ = global.$;
                Settings.init();
                orig_onPageLoad = Core.prototype.onPageLoad;
                Core.prototype.onPageLoad = function(pageNode, arts) {
                    if (!_CORE_INSTANCE) _CORE_INSTANCE = this;

                    filterArtsAsync(pageNode, arts).then(function(filtered) {
                        return orig_onPageLoad.call(_CORE_INSTANCE, pageNode, filtered);
                    });
                };

                var jDropDown = $(".sorting-block__dropdown");
                var jDDBlock = $(
                    "<ul class='sorting-block__list sorting-block__list_padding'></ul>"
                );
                jDropDown.prepend(jDDBlock);
                var jDDShowHideLi = $(
                    "<li class='sorting-block__item format_link'><span class='sorting-block__link'>Скрыть Мои Книги</span></li>"
                ).click(function() {
                    if (Settings.hideOrShowOwned == "h") {
                        Settings.hideOrShowOwned = "s";
                    } else {
                        Settings.hideOrShowOwned = "h";
                    }
                    global.location.reload();
                });
                if (Settings.hideOrShowOwned == "h") jDDShowHideLi.addClass("active");
                jDDBlock.prepend(jDDShowHideLi);


                var jDDShowIgnoredLi = $(
                    "<li class='sorting-block__item format_link'><span class='sorting-block__link'>Показать скрытые</span></li>"
                ).click(function() {
                    Settings.showIgnored = !Settings.showIgnored;
                    global.location.reload();
                });
                if (Settings.showIgnored) jDDShowIgnoredLi.addClass("active");
                jDDBlock.prepend(jDDShowIgnoredLi);

            });
            return;
        }
        setTimeout(start_collection, 1);
    }

    function start() {
        if ("litres" in global) {
            if ("page" in global.litres) {
                if ("biblio_book" in global.litres.page) {
                    start_book();
                    return;
                }
                if ("biblio_collection" in global.litres.page) {
                    start_collection();
                    return;
                }
            }
        }
        setTimeout(start, 1);
    }
    start();
})(window);