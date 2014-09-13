App.um = { }
App.backend.waitEvents = (function create_backend_wait_events(conn){
    /* channel#2: receive events from backend */
    var defaults
    conn.suspendEvents(false)// `this` fires own signal in callback()
    conn.url = App.backendURL + '/um/lib/wait_events'
    conn.timeout = App.cfg.extjs.wait_events.timeout || (1 << 22)// ~ hour
    conn.defer = null
    defaults = {
        autoAbort: true,// backend has only one `res` per `req.session`
        callback:
        function backend_events(o, success, res){
        var data
            if(success){
                if(App.User.internalId){// tmp store for status in case of connection errors
                    App.User.internalId = ''
                }
                try {
                    data = JSON.parse(res.responseText)
                } catch(ex){
                    success = false
                    console.error('JSON App.backend.waitEvents:')
                    console.error(res)
                    data = ex.stack
                    Ext.Msg.show({
                       title: l10n.errun_title + ' JSON App.backend.waitEvents',
                       buttons: Ext.Msg.OK,
                       icon: Ext.Msg.ERROR,
                       msg:
('data: ' + (res.responseText || 'empty')).slice(0, 16).replace(/</g, '&lt;')
+'<br><b>'+ l10n.errun_stack + '</b>' + data.replace(/</g, '&lt;')
                    })
                }
                if(conn.defer){
                    clearTimeout(conn.defer)
                    conn.defer = 0
                }
                if('usts@um' == data[0].ev){// init || set status
                    if(App.User.id.slice(4) == data[0].json.slice(4)){
                        App.User.id = data[0].json
                        Ext.getCmp('um.usts').setIconCls(
                            'appbar-user-' + App.User.id.slice(0, 4)
                        )
                    }
                }
                Ext.globalEvents.fireEventArgs(
                    'wes4UI',
                    [ success, data ]
                )
                req()
                return
            }

            if(res.timedout){
                req()
                return
            }
            if(-1 == res.status){// autoAbort (e.g. manual request)
                return// defaults.callback() is there
            }
            // if any error
            console.error('App.backend.waitEvents:')
            console.error(res)

            if(!App.User.internalId){
                App.User.internalId = App.User.id// mark as offline in case of
                App.User.id = 'offl' + App.User.id.slice(4)// permanent error
                Ext.getCmp('um.usts').setIconCls('appbar-user-offl')
            }
            conn.defer = Ext.defer(// retry a bit later
                req,
                App.cfg.extjs.wait_events.defer || (1 << 17)// ~ two minutes
            )
            Ext.globalEvents.fireEventArgs(
                'wes4UI',
                [ success, res.statusText || 'Connection error' ]
            )
        }
    }
    req({
        params: 'onli',
        callback:
        function get_init_user_id(o, success, res){
        var data, i
            if(success && res.responseText){
                data = JSON.parse(res.responseText)
                i = data.length - 1
                do {
                    if('usts@um' == data[i].ev){
                    // assign backend's ID instead of autogenerated User Model's ID
                    // used in e.g. Chat to make this user bold
                        App.User.id = data[i].json
                        App.User.internalId = ''
                        data = null
                        break
                    }
                } while(i--)
            }
            data && success && (success = false)

            defaults.callback(o, success, res)
        }
    })// setup waiting cycle, send initial user status

    return req// return function to act manually

    function req(opts){
    var ev = 'initwes@UI'
        Ext.globalEvents.fireEventArgs(ev, [ ev ])

        //backend if no status: w.res.statusCode = 501// "Not Implemented"
        ev = App.User.id.slice(0, 4)
        if(!opts){
            opts = { params: ev }
        } else if(!opts.params){
            opts.params = ev
        }

        return conn.request(Ext.applyIf(opts, defaults))
    }

})(Ext.create('App.backend.Connection'))
