﻿/*====---- APP: self process management ----====*/
(function(require, process, log, cerr, eval, setTimeout, RegExp, Math) {
	var http = require('http'), net = require('net'), inspect = require('util').inspect
	,ctl_runs = null, app_runs = null, db_runs = null
	,err_log = [], gsm_inf = [], srv_log = [ 'Log start @[' + _date() + ']']

function _chklen(logs) {
//prevent memory hug, when web client is closed, thus doesn't read and clears log arays
//full logs are on the file system anyway
	if (logs.length > 177)
		logs = logs.slice(87)
}
function _gsm(msg) { log (msg) ; _chklen(gsm_inf) ; gsm_inf.push(msg) }
function _log(msg) { log (msg) ; _chklen(srv_log) ; srv_log.push(msg) }
function _err(msg) { cerr(msg) ; _chklen(err_log) ; err_log.push(msg) }
function _date(){ //ISODateString
	function pad(n){return n<10 ? '0'+n : n}
	var d = new Date()
	return d.getUTCFullYear()+'-'
      + pad(d.getUTCMonth()+1)+'-'
      + pad(d.getUTCDate())+'T'
      + pad(d.getUTCHours())+':'
      + pad(d.getUTCMinutes())+':'
      + pad(d.getUTCSeconds())+'Z'
}
var str2hex = function(s) {
/* // from `websocket-client` by Peter Griess
    var hexChars = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'a', 'b', 'c', 'd', 'e', 'f'
    ];

    var out = '';
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        out += hexChars[(c & 0xf0) >>> 4];
        out += hexChars[c & 0x0f];
        out += ' ';
    }

    return out.trim();
//reading char codes from stdin
process.stdin.on('data', function (ch) {
  process.stdout.write(' data: 0x' + ch.toString().charCodeAt(0).toString(16))
 }
)
*/
//  using RE:
	return s.replace(/./g,function(ch){ return ' '+ch.charCodeAt(0).toString(16) })
			.toUpperCase()
}

process.on('uncaughtException', function (err) {
	_err('fatal uncaught exception: ' + err + "\n" + err.stack)
})

process.on('exit', function () {
	log('telsms nodeJS exit.')
})

/*unsupported ---- OLD PLAN ---- process.on('SIGINT', function () {
	log('nodeJS app got SIGINT. Grace shutting down...\n')
	process.exit(0)
})*/

var ctl = http.createServer(function (req, res) { // new plan
	var status = 200, len = 0, body = null
	if ('/cmd_exit' == req.url) {
		process.nextTick(function () {
			process.exit(0)
		})
	} else if ('/sts_running' == req.url) {

	} else if ('/cmd_stat' == req.url) {
		if ('GET' == req.method) {
			body = Math.ceil(process.uptime()).toString()
			len = body.length
		}
	}
	res.writeHead(status, {
'Content-Length': len,
'Content-Type': 'text/plain' })
	res.end(body)
})

/*====---- APP: telnet GSM part ----====*/

/* @inbuf		input buffer for full text lines from ME
   @TE2ME_cmds	commands from user to modem

   @gsmtel_runs	HW connection flag for TE2ME cmd loop start
*/
var inbuf = []

function get_input_lines(s) {
	if(!ta) {
		_err('app error get_input_lines(): ta is null')
		return
	}
/* join chuncks from the network and queue them in full lines
 */
	if (typeof s != 'string') {
		try { s = String(s)
		} catch(e) { return }
	}

_gsm('data event got:"' + s + '"')
_gsm('data event got hex:"' + str2hex(s) + '"')

	inbuf.push(s) // add chunck to array
/* Commands are usually followed by a response that includes
   "<CR><LF><response><CR><LF>". (XT55 Siemens Mobile doc)
*/
	if (RegExp(ta._end_ch).test(s)) { // full command in chunck
		//join all and return to cmd handler
		//remove repeated, front and tail new lines
		s = inbuf.join('')
			.replace(/\r+/g,'')
			.replace(/(^\n+)|(\n+$)/g,'')
			.replace(/\n+/g,'\n')
		_gsm('s: "' + s.replace('\n', '|n') + '"')
		inbuf.splice(0) // clear
		return s ? s.split('\n') : null
	} // else:
	// 1  split by \n, return all but last cmds to cmd handler
	// 2< or just loop this fun() until there is full set of lines
	return
}
var	TE_ME_mode = 'sync' // || 'async'
	,ta ,ME = {}
	,gsmtel_runs = null //,gsmtel_cmds = []

/* GSM engines -,   ME (Mobile Equipment), MS (Mobile Station),
   are referred	|   TA (Terminal Adapter), DCE (Data Communication Equipment)
		   to as`:  or facsimile DCE (FAX modem, FAX board). (XT55 Siemens Mobile doc)*/

ME.GSM = { _dscr: "GSM modem via Telnet interface"
//== GSM command aliases: ==

/* 1.7.1 Communication between Customer Application and XT55 (Siemens Mobile doc)

Leaving hardware flow control unconsidered the Customer Application (TE) is coupled
with the XT55 (ME) via a receive and a transmit line.
Since both lines are driven by independent devices collisions may (and will) happen,
i.e. while the TE issues an AT command the XT55 starts sending an URC. This probably
will lead to the TE’s misinterpretation of the URC being part of the AT command’s
response.
To avoid this conflict the following measures must be taken:
= If an AT command is finished (with "OK" or "ERROR") the TE shall always wait at
  least 100 milliseconds before sending the next one. This gives the XT55 the
  opportunity to transmit pending URCs and get necessary service.

  Note that some AT commands may require more delay after "OK" or "ERROR" response,
  refer to the following command specifications for details.

= The TE shall communicate with the XT55 using activated echo (ATE1), i.e. the XT55
  echoes characters received from the TE.

  Hence, when the TE receives the echo of the first character "A" of the AT command
  just sent by itself it has control over both the receive and the transmit paths.
  This way no URC can be issued by the XT55 in between.

i knew that!!!
*/
//modules. default set up
	,curm: null
	,modules: [ { modid:null ,ownum:null ,re:null ,cmdq: ['login'] ,op: '??' ,sigq: '??'} ]
	,modqlenTotal: 1 // 'login' above
	,defmod: 1
//data
	,initcmds: [ 'ate1v1+CMEE=2', 'ati', 'at+CSQ', 'at+COPS=3,0', 'at+COPS?' ]
	,_end_ch:'\n$'
	,atsetup: 'ate1v1+CMEE=2' // _atok: 'OK$' || v0 -- _atok: '0$'
	,info: 'ati'
	,signal: 'at+CSQ'
	,cfgOpName: 'at+COPS=3,0'
	,getOpName: 'at+COPS?'
//== private ==
	,  __err: function(e) { _gsm('E220 error: ' + e) ; return this._yes_next + '-err' }
	,__errfa: function(e) { _gsm('E220 error fatal: ' + e) ; return this._yes_next + '-fatal-err' }
	,  __nop: function(e) {}
	,   _err: function(e) {}
	,_cmd: 'no command'
	,_yes_next: 'yes-next'
	,_atdata: []
	,_atok: 'OK$'
	,_sync_ok: ''
// std handlers
	,_hsync: 'handle-sync'
	,_handle: function(tamode, e) {}
	,_async_handlers: []
	,_appcb: null // ??? application's call back
//== public ==
	,login: function(e) {
_gsm("login: GSM via Terminal Telnet server")
		this._cmd = 'login'
//serial terminal program writes first line on telnet: "Terminal remote server"
		this._sync_ok = '^Terminal'
		this._err = this.__err
		this._handle = this.__handle
		return 'handle-sync'
	}
	,get: function(e) {
_gsm("get: noop")
// empty command in this gsm interface, calls next without handling of income data
		return this._yes_next
	}
	,release: function(e) {
_gsm("release: noop!")
		return this._yes_next
	}
	,disconnect: function(e) {}
	,at: function(sock, atcmd){
		this._atdata_handler = null // sync atcmd --inside data--ok data handler
		this._err = this.__err // common error trap
		this._cmd = atcmd

		if (this._sync_ok !== this._atok) {
/* first `at` command and first setup of modem communication: 'ate1v1+CMEE=2' (@this.atsetup)
   1) e1: echo on for head and tail sync
   2) v1: verbose cmd run codes e.g. '^OK$'
   3) +CMEE=2: error descriptions instead of codes */

			this._sync_ok = this._atok
			this._handle = this.__handle //simple handler until full `at` sync
// setup of `at` cmd sync. this command may or may not receive its echo
// thus handling must wait usual @_atok reply
			this._err = this.__nop
_gsm('at write setup: `' + atcmd + '`')
/* The "AT" or "at" prefix must be set at the beginning of each command line.
   To terminate a command line enter <CR>. (XT55 Siemens Mobile doc)
   <CR><LF> is used here:
*/
			sock.write(atcmd + '\r\n')

			this._async_handlers.push(
				 this.SRVSTh
				,this.CSQh
				,this.CUSDh
				,this.CUSDht
			) //set up all async handlers

			return 'handle-sync'
		} else if (this._handle !== this.__athandle){
// head and tail sync of any `at` command
			this._handle = this.__athandle
		}

/* 1) async AT commands with same prefix
   NOTE: upper case AT. This command issues 'OK',
         ta transmit, async ta recv, then ta reply with same prefix as cmd itself(+CUSD):
,---- USSD request --
|AT+CUSD=1,"*100#",15
|
|OK
.... some time delta
|+CUSD: 0,"Balans=3394r (OP=9777 do 09.05 23:19) Ostatok: MB=43.6 min=232",15
`----
   2) aync AT command's preliminary results with same prefix(+CMGS),
      final via other command (+CDSI)
,---- SMS sending --
|at+cmgs="+375298077782"
|hi, olecom.[ctrl+x]
# с русской кодировкой херь нужно разбираться
# ушла SMS, id=152
|+CMGS: 152
|OK
|
# SMS-STATUS-REPORT получен в память SM позицию 11
# (настройки могут быть разные куда писать)
|+CDSI: "SM",11
|
# выбираем какую память читать
|at+cpms="SM"
|OK
|+CPMS: 19,30,19,30,19,30
|
# читаем позицию 11
|at+cmgr=11
# мессага id=152 доставлена (фотмат этой хери может быть разный)
|+CMGR: "REC UNREAD",6,152,"+375298022483",145,"12/03/22,02:42:12+12","12/03/22,02:42:17+12",0
#второй раз уже пишет, что прочитано
|at+cmgr=11
|+CMGR: "REC READ",6,152,"+375298022483",145,"12/03/22,02:42:12+12","12/03/22,02:42:17+12",0
`----
ATV[10]:
OK		 	0 Command executed, no errors
CONNECT		1 Link established
RING 		2 Ring detected
NO CARRIER 	3 Link not established or disconnected
ERROR 		4 Invalid command or command line too long
NO DIALTONE 6 No dial tone, dialling impossible, wrong mode
BUSY 		7 Remote station busy

at+cmgr=1

+CMS ERROR: 321
AT+CEER

+CEER: No cause information available

OK
320 Memory failure
321 Invalid memory index
322 Memory full
*/
		switch (atcmd) {
		case 'ati': /* data inside cmd - ok block */
			this._handle = function(ta_lines_arr) {
				for (var i in ta_lines_arr) {
					if (RegExp(this._sync_ok).test(ta_lines_arr[i])) {
						//model + revision + imei
						app.gsm = this._atdata.splice(1).join('<br/>')
						this._atdata.splice(0)
						this._handle = this.__handle
						return this._yes_next
					} else this._atdata.push(ta_lines_arr[i])
				}
_gsm('ati handler awaits @_sync_ok')
				return 'ati-loop'
			}
        break
		case this.getOpName:
			this._atdata_handler = this.COPSh
		break
		case this.CSQ:
			this._atdata_handler = this.CSQh
		break
		}
_gsm('at write: `' + atcmd + '`')
		sock.write(atcmd + '\r\n')
		return 'handle-sync'
	}
/*  Handlers
	NOTE: async handler must look up all atdata[] for its match
*/
	,SRVSTh: function(atdata) {
		for(var i in atdata) {
			if (/SRVST:2/.test(atdata[i])) {//async: ^SRVST:2
				app.op = '??? '
				ta.curm.cmdq.unshift(ta.getOpName)
				ta.curm.cmdq.unshift(ta.atsetup)
			}
		}
	}
	,COPSh: function(atdata) {
		for(var i in atdata) {
			if (/COPS:/.test(atdata[i])) {// async: +COPS: 0,0,"MTS.BY",2
				app.op = atdata[i].replace(/(^[^"]+")|("[^"]*$)/g,'')
				break
			}
		}
	}
	,CSQ: 'at+CSQ'
	,CSQh: function(atdata) {
		var d
		if (this.CSQ == atdata[0]) { // sync: '+CSQ: 20,99'
			d = atdata[1]
		} else for(var i in atdata) {
			if (/RSSI:/.test(atdata[i])) { //async: '^RSSI:25'
				d = atdata[i]
				break
			}
		}
		if (d)
			app.sigq = d.replace(/[^:]*:([^,]+).*/,'$1') +'/31'
	}
	,_in_ussd: !true
	,CUSDht:function(atdata) {// ussd multiline tail
		if(ta._in_ussd) for(var i in atdata) {
			if (/",[^,]*$/.test(atdata[i])) {  // async: '...",15' || '.",1' as now in 'velcom'...
				ta._atdata.push(atdata[i])
				if(ta._appcb) {
					ta._appcb(ta._atdata.join('<br/>'))
					ta._appcb = null
					ta._atdata.splice(0)
				}
				ta._in_ussd = !true
				break // read all multiline ussd reply
			} else ta._atdata.push(atdata[i])
		}
	}
	,CUSDh: function(atdata) {// ussd head
/*
0 no further user action required (network initiated USSD-Notify,
  or no further information needed after mobile initiated operation)
1 further user action required (network initiated USSD-Request, or
  further information needed after mobile initiated operation)
2 USSD terminated by network
3 other local client has responded
4 operation not supported
5 network time out */
//??? не понимаю почему здесь не сработал `this`??? нужна привязка к глобальному `ta`
// так как я не знаю контекста этого `this`, лучше использовать глобальные переменные и не мучиться
		for(var i in atdata) { // async: '+CUSD: 0,"Vash balans sostavlyaet minus 3511 rublej...
			if (/^[+]CUSD: [01]/.test(atdata[i])) {
_gsm('USSD head: ' + atdata[i])
				ta._in_ussd = true
				if (/^[+]CUSD: 1/.test(atdata[i])) {
					// cancel USSD continuation (portals, spam etc.)
					ta.curm.cmdq.unshift('AT+CUSD=2') //   second!
					ta.curm.cmdq.unshift('\u001b') //<ESC> first!
				}
//????				process.nextTick(_do_TE2ME_cmd_loop)
				break
			}
		}
	}
	,__athandle: function(ta_lines_arr, samode) {
/* when modem's `echo` is on, then all `at` command's ME data starts from command itself
   this is the first sync point, tail must be ended with _atok, final sync point
   if first fails, then something happened with connection or getting of a voip module
   if second fails, this can be some fatal connection problems

-- i knew that, see "1.7.1 Communication between Customer Application and XT55"
*/
_gsm('at handler mode: ' + samode + ' arr: ' +ta_lines_arr)
		if (/sync$/.test(samode)) {
			var i = 0
			if (/handle-sync$/.test(samode)) while (true) {
				if (ta_lines_arr[i] == this._cmd) {
_gsm("got head of async cmd: " + this._cmd)
					break
				}
				if(++i >= ta_lines_arr.length)
					return 'AT-sync'
			} // looking 4 head

			while (true) {
				if (ta_lines_arr[i].match(RegExp(this._sync_ok))) {
_gsm("got tail sync cmd: " + this._cmd)
_gsm("atdata: " + this._atdata.join('<br/>'))
					if(this._atdata_handler) /* data inside atcmd - ok block */
						this._atdata_handler(this._atdata)
					this._atdata.splice(0)
//AT handles async the same way as this._handle = this.__handle
					return this._yes_next
				} else this._atdata.push(ta_lines_arr[i])

				if(++i >= ta_lines_arr.length)
					return 'AT-sync'
			} // searching 4 tail
_err("gsmtel: !!! MUST NOT BE HERE1 !!!" + this._cmd)
			return this._yes_next
		} else { // the same way as this._handle = this.__handle
			for (var i in this._async_handlers) {
				this._async_handlers[i](ta_lines_arr)
			}
			return 'yes-next-AT-asyn'
		}
	}
	,__handle: function(ta_lines_arr, samode) {
/* simple sync and async handler
   sync commands are done, when any line from ta match RE(@this.sync_ok)
   async handlers are called otherwise */
_gsm('handler ME mode: ' + samode + '\nthis._sync_ok:' + this._sync_ok + '\nthis._cmd:' + this._cmd)
		if (/sync$/.test(samode)) {
			var sync = RegExp(this._sync_ok)
			for (var i in ta_lines_arr) {
_gsm('ta_lines_arr[i]: ' + ta_lines_arr[i])
				if (ta_lines_arr[i].match(sync)) {
					_gsm("handled sync cmd: " + this._cmd)
					return 'yes-next-sync'
				}
			}
// no match, and since this is sync cmd, then error
// _err() must return either next cmd or do something to actually get cmd done
// clear sync flag to deal with possible async garbage between successive commands
			return this._err(ta_lines_arr.join(''))
		} else {
//there can be any async garbage between successive commands
			for (var i in this._async_handlers) {
				this._async_handlers[i](ta_lines_arr)
			}
			return 'yes-next-asyn'
		}
	}
	,qcmds: function (append_this_cmds, modid) {
	/*if (!(cmd_queue instanceof Array)) {
		_err('gsmtel queue_cmds(cmds, queue): @queue must be an array')
		return
	}*/
	var mcmdq
	if (!modid) {
		mcmdq = ta.modules[ta.defmod - 1].cmdq
	} else for (var i in ta.modules) {
		if(ta.modules[i].modid == modid){
			mcmdq = ta.modules[i].cmdq
			break
		}
	}

	if (append_this_cmds instanceof Array) {
		if (append_this_cmds.length <= 0)
			return
		mcmdq.push('get')
		for (var i in append_this_cmds) {
			if (append_this_cmds[i]) {
				if ('string' === typeof append_this_cmds[i]) {
					mcmdq.push(append_this_cmds[i])
					ta.modqlenTotal++
				} else {
					_err('qcmds(arg): @arg['+i+'] is null, must be string')
				}
			}
		}
		mcmdq.push('release')
		ta.modqlenTotal += 2
	} else {
		if ('string' === typeof append_this_cmds) {
			if (append_this_cmds.length > 0) {
				mcmdq.push('get')
					mcmdq.push(append_this_cmds)
				mcmdq.push('release')
				ta.modqlenTotal += 3
			}
		} else {
			_err('qcmds(arg): @arg is not string or array!')
		}
	}
_gsm('mcmdq in "'+modid+'": '+JSON.stringify(mcmdq))
}// qcmds
}// ME.GSM

ME.E220 = { _dscr: "HUAWEI E220"
}

ME.MV37X = { _dscr: "MV-374 / MV-378 VoIP GSM Gateway"
	,login: function(sock, e) {
		const pass_sync = 'word:.*$'
_gsm("MV37X login! : " + ta._sync_ok)
	if('login' !== ta._cmd) { // init once
			ta._cmd = 'login'
//on telnet connect /^user/name and password is asked interactively (EOL != \n)
			ta._sync_ok = '^user'
			ta._end_ch =':.*$' // ME interractive mode
		}
		ta._handle = function(arg) {
		var r = ta.__handle(arg)
_gsm("MV37X login handle r: " + r)
			if(/^yes/.test(r)) {
				if('^user' == ta._sync_ok) {
					ta._sync_ok = pass_sync
_gsm("MV37X sock write: login")
					sock.write('voip\r\n')
				} else if (pass_sync == ta._sync_ok){
					sock.write('1234\r\n')
_gsm("MV37X sock write: 1234")
					ta._sync_ok = '\]$'
					ta._end_ch = '\n$' // ME normal mode line reading mode
					ta._handle = ta.__handle // all chain handeled, goto next command
					ta._err = ta.__nop // eat stuff in std handler
					return ta._hsync // set next (std) handler's arg
				} else { /* collect or handle mid data here */ }
			} /* returns nothing, 'cos this handler doesn't care about @arg */
		}//fun
		return ta._hsync
	}
	,get: function(sock) {
_gsm('MV37X get cmd param write: `' + ta.curm.modid + '`')
		sock.write(ta.curm.modid + '\r\n')
		ta._cmd = 'get'
//MV37X on get writes 'got!! press ctrl+x to release module X.'
		ta._sync_ok = '^got'
		ta._err = ta.__nop //on error nothing happens
		ta._handle = ta.__handle //give job to std handler's
		return ta._hsync         //sync part
	}
	,release: function(e) {
_gsm("MV37X release. send CTRL+X CAN 0x18")
		sock.write('\u0018')
		ta._sync_ok = '\]$' //switch std sync handler to MV37X's cmds
		ta._err = ta.__nop
		ta._handle = ta.__handle
		return ta._hsync
	}
}

var modring = 0

function _do_TELNET2MODULES_cmd_loop(setup) {
	if(!gsmtel_runs) {
//TODO: check if user closes all manually `connect` && `disconnect` commands
		//ta.curm.cmdq.splice(0) // clear cmds
// last cmd in queue must receive error
// not last, but currently set up handler must get show stop event
		_gsm('telnet2modules: NOLINK')
		return
	}

	if(setup){// first run
		if(ta.modules.length > 0) {
			modring = 1
			ta.curm = ta.modules[modring - 1]
		}
		_do_TELNET2MODULES_cmd_loop()
	}
_gsm('sch: ta.modqlenTotal: ' + ta.modqlenTotal)

	if(ta.modqlenTotal <= 0)
		return

	while (ta.modules[modring - 1].cmdq.length <= 0){
		if(++modring > ta.modules.length)
			modring = 1
	}
	ta.curm = ta.modules[modring - 1]

_gsm('sch: selecting "' + ta.curm.modid + '"')
	while (true) {
		if('release' != ta.curm.cmdq[0]){
			if (ta.curm.cmdq <= 0) {
				ta.qcmds('release', ta.curm.modid)
				_do_TE2ME_cmd_loop()
				break
			}
			_do_TE2ME_cmd_loop()
		}
	}
	process.nextTick(_do_TELNET2MODULES_cmd_loop)
}

function _do_TE2ME_cmd_loop(ta_lines_arr) {
/* Main command and data handling
@ta_lines_arr: if defined, then data event has been accured,
               and there are some data lines to sent to sync or async handlers

@ta_lines_arr: undefined, set up the first command from the @ta.curm.cmdq queue

@gsmtel_runs: if null, then nothing happens (@ta.curm.cmdq can be cleared,
              because link is down and new set up chain of command will be needed
              and queued on connect)
*/
	if (undefined !== ta_lines_arr) {
		if (!(ta_lines_arr instanceof Array)) {
			_err('gsmtel _do_TE2ME_cmd_loop(arr): @arr must be arrays if defined')
			return
		}
	}

	if(!gsmtel_runs) {
//TODO: check if user closes all manually `connect` && `disconnect` commands
		//ta.curm.cmdq.splice(0) // clear cmds
// last cmd in queue must receive error
// not last, but currently set up handler must get show stop event
		_gsm('telnet: NOLINK')
		return
	}
	var next_cmd = 'yes-next-sync'
	//              ^^^ -- run do() in the end
	//                  ^^^^ - set up next cmd?
	//                       ^^^^ - TE_ME mode
_gsm('do loop')
	if (ta_lines_arr) {
_gsm('cmd handle: ' + ta_lines_arr.join('|'))
		next_cmd = ta._handle(ta_lines_arr, TE_ME_mode)
	}

	_gsm('handler ret || cmd to setup: ' + c)

	if (RegExp(ta._yes_next).test(next_cmd)) {
		var c = ta.curm.cmdq[0]
_gsm('cmd to setup: ' + c)
do {
		if (!c) {
			TE_ME_mode = ''
			return //and cmd queue
		}
		if(/^at/i.test(c)) {
//AT: specially handeled subset of commands
			next_cmd = ta.at(gsmtel, c)
			break // like goto ta.curm.cmdq.shift()
		}
//all others gsm iface commands
		if(ta.hasOwnProperty(c)) {
// current module is scheduled in modules ring by upper event loop
			next_cmd = ta[c](gsmtel)
			break
		}
		if(c.charCodeAt(0) < 0x20) {
_gsm('direct write of:' + c)
			gsmtel.write(c)
			break
		}
		_err('no command `' + c + '` in module "' + ta._dscr)
} while(false)
		ta.curm.cmdq.shift()
		ta.modqlenTotal--
	}
	if (next_cmd) { // if set
		if(/^yes/.test(next_cmd)) {
// 1. command is empty in the gsm interface, thus try to set up next one
// 2. or handler done its job, next command must be set up
			_do_TE2ME_cmd_loop()
		} else
			TE_ME_mode = next_cmd // sets up new mode
	} // else same cmd handler does it's data handling
}

var gsmtel_addr = { //GSM_TELNET="localhost:8023"
		port: process.env.GSM_TELNET.replace(/[^:]*:/,'')
		,fqdn: process.env.GSM_TELNET.replace(/:[^:]*/,'')
	}
	,gsmtel = net.connect(gsmtel_addr.port, gsmtel_addr.fqdn, gsmtel_ok)

gsmtel.setTimeout(1024) //see NOTE below

function gsmtel_ok() {
	if(!gsmtel_runs) {
		_gsm('gsmtel_runs is null, wait and reconnect (4 sec) ...')
		gsmtel_runs = 'reconnect'
		_log('@[' + _date() + '] gsm telnet: reconnecting...')

/*
NOTE:
gsmtel's socket timout must be less than this one
or `node` will say:
(node) warning: possible EventEmitter memory leak detected.
11 listeners added. Use emitter.setMaxListeners() to increase limit.
*/
		setTimeout(gsmtel_ok, 4096)
	} else if ('reconnect' == gsmtel_runs) {// no connection, try later
		gsmtel_runs = null
		gsmtel.connect(gsmtel_addr.port, gsmtel_addr.fqdn /*, no need in another callback*/)
	}
}
// set up event handlers once
gsmtel.on('connect', function(){
	var model = process.env.GSM_MODEL, i, j

	gsmtel.setEncoding('ascii')
// general GSM interface via Telnet of Terminal.exe by <braypp@gmail.com>
	ta = {}
	for(j in ME.GSM)
		ta[j] = ME.GSM[j]

	if (/^{/.test(model)) {
/*GSM_MODEL='{ "name": "MV-374 / MV-378 VoIP GSM Gateway"
,"module1": { "own":"+375298714075", numre: "+37529[2578] +37533" }
,"module2": { "own":"set me in cfg", numre: "+37529[136]  +37544" }
,"default": 1
}'*/
	try {
		var cfg = JSON.parse(model)
		for(i in ME) {
			if(RegExp(ME[i]._dscr).test(cfg.name)) {
				var m = ME[i]
				for(j in m) {
					ta[j] = m[j]
				} // add own interface stuff to default
				break
			}
		}
		ta._dscr = cfg.name
		ta.modules.splice(0)// remove default
		j = 0
		for(i in cfg){
			if(/(^default)|(^name)|(^_)/.test(i)) {
				var m
				if(!ta.defmod && cfg.default == ++j)
					ta.defmod = i //default module
				m = {} // new module object
				m.modid = i
				m.op = m.sigq = '??' // stats
				m.ownum = cfg[i].own
				m.re = []
				cfg[i].numre.replace(/[+]/g, '^[+]').split(' ').forEach(
function(re_str){
	if(re_str)
		m.re.push(RegExp(re_str)) //REs are better than strings, imho
}
				)
				m.cmdq = []
				ta.modules.push(m)
				ta.qcmds(ta.initcmds ,m.modid)
			} else if(/^_/.test(i))
				ta[i] = cfg[i] // possible other cfg stuff
		}
		if(!j) {
			_err('model JSON config err: no modules found')
		} else if(!ta.defmod) {
			_gsm('model module selection: "default" module number is out of range or is not defined, setting "module1"')
			ta.defmod = 1
		}
	} catch(e) {
		_err('model JSON config err: ' + e)
		_gsm('JSON cfg err, use default module config')
		ta = {}
		for(j in ME.GSM)
			ta[j] = ME.GSM[j]
	}
	} else {
//simple GSM_MODEL='HUAWEI E220 HSDPA USB modem'
		for(var i in ME) {
			if(RegExp(ME[i]._dscr).test(model)) {
				var m = ME[i]
				for(var j in m) {
					ta[j] = m[j]
				}// add own stuff to default
				break
			}
		}
		ta._dscr = model
		ta.qcmds(initcmds)
	}
_gsm('ta: ' + inspect(ta))

	gsmtel_runs = '@[' + _date() + '] gsm telnet: connected to '
				+ gsmtel_addr.fqdn + ':'
				+ gsmtel_addr.port
	_log(gsmtel_runs)

	_do_TE2ME_cmd_loop() // first ever cmd is default curmod's 'login'
	process.nextTick(_do_TELNET2MODULES_cmd_loop)
	//was: _do_TE2ME_cmd_loop()
})

gsmtel.on('data', function(chars){
//gsmtel.write('ate1\r', 'utf-8', function(e,c) { log("2e: " + e + "c: " + c)})
//log('gsmtel `data` event' + chars)
	var lines = get_input_lines(chars)
_gsm('gsmtel `data` event lines:' + (lines ? lines.join('|'): 'null'))
	if (null == lines)
		return
	///process.nextTick(_do_TELNET2MODULES_cmd_loop)
	_do_TE2ME_cmd_loop(lines)
})

gsmtel.on('end', function(){
_gsm('gsmtel `end` event')
	// other end closed connection FIN packet
	gsmtel_runs = null
	_do_TELNET2MODULES_cmd_loop() //last cmd in queue must receive error

	//TODO: if !user
	setTimeout(gsmtel_ok, 4096)
    // ITS OVER!
	//state_machine_append(modem link closed)
})

gsmtel.on('error', function(e){
//NOTE: net error handler must not be inside init callback!!!
	if (e) {
		 _err('gsm telnet {addr:'+process.env.GSM_TELNET+'} err : ' + e)
		gsmtel_runs = null

		_do_TELNET2MODULES_cmd_loop()
		setTimeout(gsmtel_ok, 4096)
		//state_machine_append(err)
		return
	}
})

/*====---- APP: http web part ----====*/

var express = require('express')
    ,app = express() ,app_srv

// patch Express's Connect stuff
express.errorHandler = function errorHandler(){
	return function errorHandler(err, req, res, next){
		if (err.status) res.statusCode = err.status;
		if (res.statusCode < 400) res.statusCode = 500;
		res.writeHead(res.statusCode, { 'Content-Type': 'text/plain' });
		res.end(err.stack);
	}
}

// Configuration
app.configure(function(){
//    app.set('views', __dirname + '/views')
//    app.set('view engine', 'jade')
    app.use(express.bodyParser()) //parse JSON into objects
    app.use(express.methodOverride())
    app.use(app.router)
    //app.use('/extjs', express.static(__dirname + '/../../extjs-4.1.0-rc2'))
	//app.use('/extjs/examples/ux', express.static(__dirname + '/../../extjs-4.1.0-rc2/examples/ux'))
	//app.use('/extjs/ux', express.static(__dirname + '/../../extjs-4.1.0-rc2/examples/ux'))
    app.use('/extjs', express.static(__dirname + '/../../extjs-4.1'))
	app.use('/extjs/examples/ux', express.static(__dirname + '/../../extjs-4.1/ux'))
    app.use(express.static(__dirname + '/../_ui-web'))
/*	app.use(express.errorHandler({
        resType: 'text'
    }))*/
	app.use(express.errorHandler())
})
/*
app.configure('development', function(){
})
app.configure('production', function () {
})*/

// Routes
app.get('/', function (req, res) {
    res.redirect('/telsms.htm')
  }
)

app._htmlf = function(m, re) {
	return String(m).replace(/\n/g, '<br/>')
}
app_gsm = function(logmsg, atcmds_arr, cb, module) {
	if (logmsg)
		_gsm(logmsg)

	if(!gsmtel_runs) {
		return {
			success: !true
			,msg: 'telnet: NOLINK'
		}

	} else if ('reconnect' == gsmtel_runs) {
		return {
			success: !true
			,msg: 'telnet: reconnecting...'
		}
	} else if (!ta) {
		return {
			success: !true
			,msg: 'ME is undefined. Unexpected.'
		}
	}

	ta._appcb = cb
	//queue_cmds(atcmds_arr, gsmtel_cmds)
	ta.qcmds(atcmds_arr, module)

!!!	process.nextTick(_do_TE2ME_cmd_loop) // post-event queuing is preferable here
}

app.post('/ussd.json', function (req, res) {
//ExtJS USSD form load
	var ret
	if (!req.body.ussdNumber) ret = {
		success: !true
		,msg: "form's ussdNumber is null. Unexpected."
	};else ret = app_gsm('ussd: ' + req.body.ussdNumber
		,['AT+CUSD=1,"'+req.body.ussdNumber+'",15']
//ExtJS ussd form reply format: { "success": true, "msg": "A command was done" }
//http error reply is plain text (hacked connect's errorhandler middleware)
	,function(msg) {
		res.json({
			success: true
			,msg: msg
		})
	}
	,req.module)
	if (ret) res.json(ret) // error or other info which ends res here
  }
)

app.get('/swhw_stat.json', function (req, res) {
//ExtJS will load this once in a while into Ext Store for dataview
	var logs = [], gsms = [], errs = []
	if (srv_log.length > 0) {
		for (var i in srv_log) { logs.push(app._htmlf(srv_log[i])) }
		srv_log.splice(0)
	}
	if (gsm_inf.length > 0) {
		for (var i in gsm_inf) { gsms.push(app._htmlf(gsm_inf[i])) }
		gsm_inf.splice(0)
	}
	if (err_log.length > 0) {
		for (var i in err_log) { errs.push(app._htmlf(err_log[i])) }
		err_log.splice(0)
	}
    res.json({
		stats: [
{ os: app.os
  ,server: app.server
  ,db: app.db
  ,op: app.op
  ,gsm: app.gsm
  ,uptime: Math.ceil(process.uptime())
  ,sigq: app.sigq
}
		]
		,logs: logs, gsms: gsms, errs: errs
	  }
	)
  }
)

/*
***
    Error handling for web app, http control channel.
	All errors are fatal except -- EAGAIN && EINTR while reading something.
	Latter must be handled by nodeJS. Thus we exit(1) if there is any.

	External watchdog or user must take care about running this "forever".

***
 */
app_srv = http.Server(app)
app_srv.on('error', function (e) {
	if (/EADDR.*/.test(e.code)) {
_err("web app can't listen host:port='*':" + process.env.JSAPPCTLPORT +
			"\n" + e +
		    "\npossible 'app.conf' 'JSAPPCTLPORT' port collision or bad IP address")
	} else {
_err("web app: " + e)
		//state_machine_append(err)
	}
	if (!app_runs)
		process.exit(1)
  }
)

ctl.on('error', function (e) {
//NOTE: net error handler must not be inside init callback!!!
	if (EADDRINUSE == e.code) { //'EADDRINUSE' 'EADDRNOTAVAIL'
_err("controlling channel can't listen host:port='127.0.0.1':" + process.env.JSAPPCTLPORT +
			"\n" + e +
		    "\npossible 'app.conf' 'JSAPPCTLPORT' port collision")
	} else {
_err("controlling channel: " + e)
	}
	if (!ctl_runs)
		process.exit(1)
  }
)

app_srv.on('listening', function () {
	app_runs = _date()
  }
)

ctl.on('listening', function () {
	ctl_runs = _date()
  }
)

app_srv.on('close', function () {
	app_runs = null
  }
)

ctl.on('close', function () {
	ctl_runs = null
  }
)

ctl    .    listen(process.env.JSAPPCTLPORT, '127.0.0.1', function() {
	app_srv.listen(process.env.JSAPPJOBPORT,
	  function() {
		process.nextTick(function () {
			_log(
"telsms Express server is listening on port " + process.env.JSAPPJOBPORT +
" in " + app.settings.env + " mode\n"+
"controlling channel is http://127.0.0.1:" + process.env.JSAPPCTLPORT + "\n")

			app.os = process.platform + '@' + process.arch
			app.server = 'nodeJS v' + process.versions['node']
			app.db = 'connecting....'
			//setting up link with gsm
			app.gsm = 'connecting....'
			app.op = 'none....'
		  }
		)
	  }
	)
  }
)

/*====---- APP: memory = data base ----====*/

try { // third party modules better to try{}
	db_runs = false
	var mongo = require('mongojs'), db
} catch (e) {
	console.error("[error] mongojs init: " + e)
	process.exit(1)
}

var db_run_check = function() {
	if (!process.env.MONGODS) {
		_log("db: `process.env.MONGODS` is null, no db set")
		return
	}
  // mongodb-native or mongojs needs to redo connection on error
	db = mongo.connect(process.env.MONGODS + '/test', ['sms'])
	db.admin(function(aerr, a) {
	if(aerr){
		_err("db.admin(): " + aerr)
		setTimeout(db_run_check,4096)
		return
	}
	a.command({buildInfo: 1}, function(e, d) {
		if(e){
			setTimeout(db_run_check,4096)
			_err('db.admin.command():' + e)
			return
		}
		app.db = "mongodb v" + d.documents[0]['version']
		_log("telsms DB server: " + app.db + "@" + process.env.MONGODS + "\n")
		db_runs = _date()
	  }
	)
  })
}
db_run_check()

})(require, process, console.log, console.error, eval, setTimeout, RegExp, Math)
//olecom: telsms.js ends here
