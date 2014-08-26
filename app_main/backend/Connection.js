/*
 * Connection to backend
 */
Ext.define('App.backend.Connection',{
    extend: 'Ext.data.Connection',
    method: 'POST',
    url: App.cfg.backend.url ? App.cfg.backend.url : '',
    defaultHeaders:{
        'Content-Type': 'text/plain; charset=utf-8'
    }
})

/*
 * Users of Connection Class
 * usage:
 *      App.backend.req('/ns/action0', 'online')
 *      App.backend.req('/ns/action1', { status: "online" })
 *      App.backend.req('/ns/action2', function callback(err, json){})
 *      App.backend.req('/ns/action3', { data: 'data'}, function callback(...){})
 */
App.backend.req = (
function create_backend(conn){
    /* channel#1: request data from backend */
    return function backend_request(url, data, options){
    var callback = Ext.emptyFn

        if(url && (0 != url.indexOf('http'))){
            url = conn.url + url
        }

        if(!options || 'function' == typeof options){
            options && (callback = options)
            options = {
                url: url,
                callback: null,
                params: null,
                jsonData: null,
                headers: null
            }
        } else {
            options.url = url
            options.callback && (callback = options.callback)
        }

        if('string' == typeof data){
            options.params = data// plain text or JavaScript for `App.backend.JS`
        } else if('function' == typeof data){
            callback = data
        } else {
            options.jsonData = data
            options.headers = {
                'Content-Type': 'application/json; charset=utf-8'
            }
        }
        options.callback = callbackBackend

        return conn.request(options)

        function callbackBackend(opts, success, xhr){
        var json = Ext.decode(xhr.responseText)

            return callback(!success || !json, json, xhr)
        }
    }
}
)(Ext.create('App.backend.Connection'))
