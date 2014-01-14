(function uglify_js_closure(con ,doc ,win ,l10n){
var devel = true
var app = { // configuration placeholders
        config: null //{ db: null ,extjs:null }
        ,user: { id: 'olecom' ,name:'Олег Верич' ,role:'склад' }//TODO:login
        ,role: { va_permissions: null }
        //,tools: { /*load_extjs: null*/ }
    }
    ,check_backend, terminate_backend
    /* two frontend parts: under `node-webkit` and `express` in browser */

    if(typeof process != 'undefined'){// `nodejs` runtime inside HTML (native desktop)
        app.process = process
        app.tray = { obj: null ,stat: 'show' }
        app.w = null
        // start local ExtJS 'App'
        node_webkit(con ,app)
    } else {// 'nodejs + connectjs': XHR communication with backend (remote web browser)
        var xhr = new XMLHttpRequest()
        xhr.open('GET' ,'/app.config.extjs.json' ,true)
        xhr.onreadystatechange = function(){
            if(4 == xhr.readyState){
                if(200 != xhr.status){
                    con && con.error && con.error(l10n.errload_config_read)
                    doc.write(l10n.errload_config_read)
                    alert(l10n.errload_config_read)
                } else {
                    // start external ExtJS 'App'
                    app.config = { extjs: JSON.parse(xhr.responseText) }
                    app.config.backend = {
                        time: new Date(),
                        msg: l10n.stsBackendXHR,
                        op: l10n.stsCheck
                    }
                    extjs_load(doc ,win)
                }
            }
        }
        xhr.send(null)
    }

    return
/*
 * front end: node-webkit part
 */
function node_webkit(con ,app){
    //TODO: wrap `uncaughtException` in ExtJS window, add xhr to backend
    app.process.on('uncaughtException' ,function(err){
        con.error('uncaughtException:', err)
        alert(l10n.uncaughtException  + err)
    })

    var gui = require('nw.gui')

    app.w = gui.Window.get()

    //if(devel) app.w.showDevTools()

    setup_tray(app.tray ,app.w)

    // long xhr pooling gets messages from backend
    load_config(app) && require('http')
    .get("http://127.0.0.1:" + app.config.backend.ctl_port ,backend_is_running)
    .on('error' ,backend_ctl_errors)
    terminate_backend = terminate
    check_backend = check
    return

function backend_is_running(res){
    res.setEncoding('utf8')
    res.on('data', function (chunk){
        var pid = chunk.slice(7).replace(/\n[\s\S]*/g, '')// remove '? pid: '

        app.config.backend.time = new Date
        app.config.backend.msg = l10n.stsBackendPid(pid)
        app.config.backend.pid = pid
        app.config.backend.url = 'http://127.0.0.1:' + app.config.backend.job_port
        app.config.backend.op = l10n.stsCheck

        get_remote_ip(extjs_load)
        con.log('reload just extjs, backend is up and running already')
    })
}

function backend_ctl_errors(e){
// NOTE: this is permanent error handler for all requests to `backend.ctl_port`
    if(app.config.extjs){// run setup only first time after ctl check
        spawn_backend(app ,extjs_load)
        con.log('backend spawned && extjs load as callback')
        return
    }
    // ignore other errors for now
    con.warn('backend_ctl_errors():')
    con.dir(e)
}

function spawn_backend(app, extjs_load){
// loads `node`+`connect` as separate process and answers on http requests,
// as for this `nw` instance, as for remote clients
// closing `nw` doesn't mean closing backend processing (maybe cfg it?)

    var fs = require('fs')
        ,log
        ,backend

    try {// check and/or create log dir
        if(!fs.statSync(app.config.log).isDirectory()){
            con.error('ERROR log dir is not a directory')
            log = l10n.errload_config_log_not_dir + app.config.log
            doc.write(log)
            app.w.window.alert(log)
            return false
        }
    } catch(ex){
        try {
            fs.mkdirSync(app.config.log)
        } catch(ex) {
            con.error('ERROR log dir:' + (ex = (' ' + app.config.log + '\n' + ex)))
            log = l10n.errload_config_log_mkdir + ex
            doc.write(log)
            app.w.window.alert(log)
            return false
        }
    }

    log = app.config.log +
          app.config.backend.file.replace(/[\\/]/g ,'_') + '.log'
    backend = require('child_process').spawn(
        'node'
        ,[ app.config.backend.file ]
        ,{
             detached: true
            ,env: {
                NODEJS_CONFIG: JSON.stringify(app.config)
            }
            ,stdio: [ 'ignore'
                ,fs.openSync(log ,'a+')
                ,fs.openSync(log ,'a+')
            ]
        }
    )
    if(!backend.pid || backend.exitCode){
        con.error('ERROR spawn backend exit code: ' + backend.exitCode)
        log = l10n.errload_spawn_backend + backend.exitCode
        doc.write(log)
        app.w.window.alert(log)
        return false
    }
    backend.unref()

    get_remote_ip(extjs_load)

    app.config.backend.time = new Date
    app.config.backend.msg = l10n.stsBackendPid(backend.pid),
    app.config.backend.pid = backend.pid
    app.config.backend.url = 'http://127.0.0.1:' + app.config.backend.job_port
    app.config.backend.op = l10n.stsStart
    con.log('backend.pid: ' + backend.pid)

    return true
}

function get_remote_ip(extjs_load){
    require('child_process').exec('ipconfig',
    function(err, stdout){
        if(!err){
            err = stdout.match(/^[\s\S]*IPv4-[^:]*: ([^\n]*)\n/)
            if(err) app.config.backend.url = app.config.backend.url
                .replace(/127\.0\.0\.1/, err[1])
        }
        extjs_load(app.w.window.document ,app.w.window)
    })
}

function check(){
    con.log('check backend')
    require('http')
    .get("http://127.0.0.1:" + app.config.backend.ctl_port
    ,backend_ctl_alive).on('error' ,backend_ctl_dead)
}

function backend_ctl_alive(res){
    res.setEncoding('utf8')
    res.on('data', function (chunk){
        var pid = parseInt(chunk.slice(7).replace(/\n[\s\S]*/g, ''), 10)// remove '? pid: '

        if(app.config.backend.pid != pid){
            con.warn('app.config.backend.pid != pid:'+ app.config.backend.pid + ' ' + pid)
            app.config.backend.pid = pid
        }
        App.sts(l10n.stsCheck, pid + ' - ' + l10n.stsAlive, l10n.stsOK)
    })
}

function backend_ctl_dead(){
    if(app.config.backend.pid)
        app.config.backend.pid = null

    App.sts(l10n.stsCheck, l10n.stsAlive, l10n.stsHE)
    con.log('backend is dead')
}

function terminate(){
    var path
    if(!app.config.backend.pid) return

    con.warn('kill pid = ' + app.config.backend.pid)

    path = process.cwd()
    path += path.indexOf('/') ? '/' : '\\'
    require('child_process').exec(
       'wscript ' + 'terminate.wsf ' + app.config.backend.pid,
        defer_request_check_kill
    )
}

function defer_request_check_kill(err){
    var msg = app.config.backend.pid + ' ' + l10n.stsKilling
    if(err){
        con.error(err)
        App.sts(l10n.stsKilling, msg, l10n.stsHE)
        return
    }
    App.sts(l10n.stsKilling, msg, l10n.stsOK)

    setTimeout(
        function send_check_request(){
            require('http')
            .get("http://127.0.0.1:" + app.config.backend.ctl_port
            ,backend_ctl_not_killed).on('error' ,backend_ctl_killed)
        }
        ,2048
    )
}

function backend_ctl_not_killed(income){
    con.dir(income)
    App.sts(l10n.stsCheck, l10n.stsAlive, l10n.stsHE)
}

function backend_ctl_killed(){
    if(app.config.backend.pid){
        app.config.backend.pid = null
        App.sts(l10n.stsCheck, l10n.stsKilled, l10n.stsOK)
    }
    con.log('backend is killed')
}

function load_config(app){// loaded only by main process -- node-webkit
    var cfg
    var fs = require('fs')

    if((cfg = app.process._nw_app.argv[0])){// cmd line
        cfg = 'config/' + cfg
    } else {// HOME config
        if(app.process.env.HOME){
            cfg = app.process.env.HOME
        } else if(app.process.env.HOMEDRIVE && app.process.env.HOMEPATH){
            cfg = app.process.env.HOMEDRIVE +  app.process.env.HOMEPATH
        }
        cfg = cfg + '/.enjsms.js'//FIXME: app specific part
        try {
            fs.statSync(cfg)
        } catch (ex){
            cfg = null
        }
    }
    if(!cfg)// default
        cfg = 'config/cfg_default.js'

    try {
        app.config = (
            new Function('var config ; return ' +
                          fs.readFileSync(cfg ,'utf8'))
        )()
    } catch(ex){
        con.error('ERROR load_config:' + (cfg = (' ' + cfg + '\n' + ex)))
        cfg = l10n.errload_config_read + cfg
        doc.write(cfg)
        app.w.window.alert(cfg)
        return false
    }
    con.log('reading config: ' + cfg + ' done')

    return check_extjs_path()
}

function check_extjs_path(){// find local ExtJS in and above cwd './'
    var fs = require('fs'), pe = '../', d = '', i, p
       ,ef = app.config.extjs.pathFile
       ,extjs_path

    /* lookup extjs.txt first */
    try{
        extjs_path = fs.readFileSync(ef).toString().trim()
    } catch(ex){
        if(app.config.extjs.path){
            extjs_path = app.config.extjs.path
            d += 'c'
        } else {
            ex.message += '\n\n' + l10n.extjsPathNotFound(ef)
            throw ex
        }
    }
    if('/' != extjs_path[extjs_path.length - 1]) extjs_path += '/'

    i = 7
    do {
       try{
            p = fs.statSync(extjs_path)
        } catch(ex){ }
        extjs_path = pe + extjs_path// add final level from `app_main` anyway
        if(p) break
    } while(--i)

    while(1){
        if(p){
            d = ''
            break
        }
        if(d){/* no 'extjs.txt' file, and cfg failed */
            d = l10n.extjsPathNotFound(ef, app.config.extjs.path, 1)
            break
        }

        if(app.config.extjs.path){
            extjs_path = app.config.extjs.path
            if('/' != extjs_path[extjs_path.length - 1]) extjs_path += '/'
        } else {/* no `extjs.txt` && no cfg value */
            d = l10n.extjsPathNotFound(ef, app.config.extjs.path, 2)
            break
        }
        i = 7, p = null
        do {
            try{
                p = fs.statSync(extjs_path)
            } catch(ex){ }
            extjs_path = pe + extjs_path
            if(p) break
        } while(--i)
        if(p) break
        d = l10n.extjsPathNotFound(ef, app.config.extjs.path)
        break
    }
    if(!d){
        app.config.extjs.path = extjs_path
        con.log('ExtJS path found: "' + extjs_path + '"')
        return true
    }
    con.error('ExtJS path not found')
    doc.getElementById('e').style.display = "block"
    doc.getElementById('d').innerHTML = d.replace(/\n/g, '<br>')
    return false
}

function setup_tray(t ,w){
    t.obj = new gui.Tray({ title: l10n.tray.title ,icon: 'app_main/css/favicon.png' })
    t.obj.tooltip = l10n.tray.winvis

    t.obj.on('click' ,function onTrayClick(){
        if('show' == t.stat){// simple show,focus / hide
            t.stat = 'hide'
            t.obj.tooltip = l10n.tray.wininv
            w.hide()
        } else {
            w.show()
            t.obj.tooltip = l10n.tray.winvis
            t.stat = 'show'
        }
    })
    con.log('setup_tray: done')
}
}// nw

/*
 * common tools for `nw` && `express` front ends
 */

function extjs_load(doc ,w){
var extjs, path
    path = app.config.extjs.path
    extjs = doc.createElement('link')
    extjs.setAttribute('rel', 'stylesheet')
    extjs.setAttribute('href', path + 'resources/css/ext-all.css')
    doc.head.appendChild(extjs)

    extjs = doc.createElement('script'),
    extjs.setAttribute('type' ,'application/javascript')
    extjs.setAttribute('charset' ,'utf-8')
    extjs.setAttribute('src' ,path + 'ext-all' + (devel ? '-debug' : '') + '.js')
    doc.head.appendChild(extjs)

    path = '1234'
    extjs = setInterval(function waiting_extjs(){
        if('undefined' != typeof Ext){
            clearInterval(extjs)
            path = Ext.Loader.getPath('Ext')
            con.log(
                'ExtJS version: ' + Ext.getVersion('extjs') + '\n' +
                'ExtJS is at <' + path + '>'
            )
            Ext.Loader.setPath('Ext.ux', path + '/../examples/ux')
            Ext.Loader.setPath('Ext.uxo', app.config.extjs.appFolder + '/uxo')
            app.config.extjs.launch = extjs_launch
            Ext.application(app.config.extjs)
            return
        } else if('' == path){
            clearInterval(extjs)
            con.error(l10n.extjsNotFound)
            doc.write(l10n.extjsNotFound)
            w.alert(l10n.extjsNotFound)
            return
        }
        path = path.slice(1)
    }, 1024)
    con.log('load_extjs: done, waiting for ExtJS')
}

function extjs_launch(){
    //Ext.state.Manager.setProvider(new Ext.state.CookieProvider)
    // handle errors raised by Ext.Error.raise()
    Ext.Error.handle = function(err){
        //TODO: error list, kebab's popup with extdesk gears to show them
        return !con.warn(err)
    }

    //TODO: for each app.config.app.modules load module
    //TODO: dynamic addition in toolbar or items/xtype construction
    //global `App` object is available now
    App.config = app.config ,App.user = app.user ,App.role = app.role
    //TODO: events via long pooling from app_backend/express
    //App.sync_clearTimeout = Ext.defer(App.sync_extjs_nodejs, 3777)

    if(app.config.extjs.fading){
        // very strange composition to get gears to fadeOut and viewport to fadeIn
        var b = Ext.getBody()
        b.fadeOut({duration:777 ,callback:
            function(){
                Ext.fly('startup').remove()
                b.show()
                Ext.create('App.view.Viewport')
                b.fadeIn({easing:'easeIn' ,duration: 1024 ,callback: backendInfo })
                con.log('extjs: faded In')
            }
        })
    } else {
        Ext.fly('startup').remove()
        Ext.create('App.view.Viewport')
        backendInfo()
    }
    app.config.extjs = null// clear ref for GC
    con.log('Ext JS + App launch: OK')

    function backendInfo(){
        App.sts(// add first System Status message
            app.config.backend.op,
            app.config.backend.msg,
            l10n.stsOK,
            app.config.backend.time
        )
        App.doCheckBackend = check_backend
        App.doTerminateBackend = terminate_backend
    }
}

})(console ,document ,window ,l10n)
