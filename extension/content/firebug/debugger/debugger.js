/* See license.txt for terms of usage */
/*jshint noempty:false, esnext:true, curly:false, unused:false*/
/*global define:1*/

define([
    "firebug/firebug",
    "firebug/lib/trace",
    "firebug/lib/object",
    "firebug/lib/locale",
    "firebug/lib/options",
    "firebug/chrome/firefox",
    "firebug/debugger/debuggerHalter",
    "firebug/debugger/debuggerLib",
    "firebug/debugger/clients/clientCache",
    "firebug/remoting/debuggerClientModule",
],
function(Firebug, FBTrace, Obj, Locale, Options, Firefox, DebuggerHalter, DebuggerLib,
    ClientCache, DebuggerClientModule) {

"use strict";

// ********************************************************************************************* //
// Constants

var Trace = FBTrace.to("DBG_DEBUGGER");
var TraceError = FBTrace.to("DBG_ERRORS");

// ********************************************************************************************* //
// Implementation

/**
 * @module
 */
Firebug.Debugger = Obj.extend(Firebug.ActivableModule,
/** @lends Firebug.Debugger */
{
    dispatchName: "Debugger",

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Initialization

    initialize: function()
    {
        Firebug.ActivableModule.initialize.apply(this, arguments);

        // xxxHonza: scoped logging should automate this (see firebug/lib/trace module).
        Firebug.registerTracePrefix("debuggerTool.", "DBG_DEBUGGERTOOL", false);
        Firebug.registerTracePrefix("breakpointTool.", "DBG_BREAKPOINTTOOL", false);

        // Listen to the debugger-client, which represents the connection to the server.
        // The debugger-client object represents the source of all RDP events.
        if (Firebug.Debugger.isAlwaysEnabled())
            DebuggerClientModule.addListener(this);

        // Hook XUL stepping buttons.
        var chrome = Firebug.chrome;
        chrome.setGlobalAttribute("cmd_firebug_rerun", "oncommand",
            "Firebug.Debugger.rerun(Firebug.currentContext)");
        chrome.setGlobalAttribute("cmd_firebug_resumeExecution", "oncommand",
            "Firebug.Debugger.resume(Firebug.currentContext)");
        chrome.setGlobalAttribute("cmd_firebug_stepOver", "oncommand",
            "Firebug.Debugger.stepOver(Firebug.currentContext)");
        chrome.setGlobalAttribute("cmd_firebug_stepInto", "oncommand",
            "Firebug.Debugger.stepInto(Firebug.currentContext)");
        chrome.setGlobalAttribute("cmd_firebug_stepOut", "oncommand",
            "Firebug.Debugger.stepOut(Firebug.currentContext)");

        // Set tooltips to stepping buttons.
        Firebug.chrome.$("fbRerunButton").setAttribute("tooltiptext",
            Locale.$STRF("firebug.labelWithShortcut", [Locale.$STR("script.Rerun"), "Shift+F8"]));
        Firebug.chrome.$("fbContinueButton").setAttribute("tooltiptext",
            Locale.$STRF("firebug.labelWithShortcut", [Locale.$STR("script.Continue"), "F8"]));
        Firebug.chrome.$("fbStepIntoButton").setAttribute("tooltiptext",
            Locale.$STRF("firebug.labelWithShortcut", [Locale.$STR("script.Step_Into"), "F11"]));
        Firebug.chrome.$("fbStepOverButton").setAttribute("tooltiptext",
            Locale.$STRF("firebug.labelWithShortcut", [Locale.$STR("script.Step_Over"), "F10"]));
        Firebug.chrome.$("fbStepOutButton").setAttribute("tooltiptext",
            Locale.$STRF("firebug.labelWithShortcut",
                [Locale.$STR("script.Step_Out"), "Shift+F11"]));
    },

    shutdown: function()
    {
        Firebug.unregisterTracePrefix("debuggerTool.");
        Firebug.unregisterTracePrefix("breakpointTool.");

        DebuggerClientModule.removeListener(this);

        Firebug.ActivableModule.shutdown.apply(this, arguments);
    },

    initContext: function(context, persistedState)
    {
        Trace.sysout("debugger.initContext; context ID: " + context.getId());

        // If page reload happens the thread client remains the same so,
        // preserve also all existing breakpoint clients.
        // See also {@DebuggerClientModule.initConext}
        if (persistedState)
        {
            context.breakpointClients = persistedState.breakpointClients;
        }
    },

    showContext: function(browser, context)
    {
        // xxxHonza: see TabWatcher.unwatchContext
        if (!context)
            return;

        Trace.sysout("debugger.showContext; context ID: " + context.getId());
    },

    destroyContext: function(context, persistedState, browser)
    {
        Trace.sysout("debugger.destroyContext; context ID: " + context.getId());

        persistedState.breakpointClients = context.breakpointClients;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // DebuggerClientModule

    onThreadAttached: function(context, reload)
    {
        Trace.sysout("debugger.onThreadAttached; reload: " + reload + ", context ID: " +
            context.getId(), context);

        // Create grip cache
        context.clientCache = new ClientCache(DebuggerClientModule.client, context);

        // Attach tools needed by this module.
        context.getTool("source").attach(reload);
        context.getTool("debugger").attach(reload);
        context.getTool("breakpoint").attach(reload);
    },

    onThreadDetached: function(context)
    {
        Trace.sysout("debugger.onThreadDetached; context ID: " + context.getId());

        context.getTool("source").detach();
        context.getTool("debugger").detach();
        context.getTool("breakpoint").detach();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends ActivableModule

    onObserverChange: function(observer)
    {
        if (this.hasObservers())
            this.activateDebugger();
        else
            this.deactivateDebugger();
    },

    activateDebugger: function()
    {
        if (this.activated)
            return;

        this.activated = true;

        DebuggerClientModule.addListener(this);

        this.setStatus();

        Trace.sysout("debugger.activateDebugger;");
    },

    deactivateDebugger: function()
    {
        if (!this.activated)
            return;

        this.activated = false;

        DebuggerClientModule.removeListener(this);

        this.setStatus();

        Trace.sysout("debugger.deactivateDebugger;");
    },

    onSuspendFirebug: function()
    {
        if (!Firebug.Debugger.isAlwaysEnabled())
            return;

        Trace.sysout("debugger.onSuspendFirebug;");

        return false;
    },

    onResumeFirebug: function()
    {
        if (!Firebug.Debugger.isAlwaysEnabled())
            return;

        Trace.sysout("debugger.onResumeFirebug;");
    },

    setStatus: function()
    {
        var status = Firefox.getElementById("firebugStatus");
        if (status)
        {
            var enabled = this.isEnabled();
            status.setAttribute("script", enabled ? "on" : "off");

            Trace.sysout("debugger.setStatus; enabled: " + enabled);
        }
        else
        {
            TraceError.sysout("debugger.setStatus; ERROR no firebugStatus element");
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Breakpoints

    setBreakpoint: function(sourceFile, lineNo)
    {
    },

    clearBreakpoint: function(sourceFile, lineNo)
    {
    },

    setErrorBreakpoint: function(compilationUnit, line)
    {
    },

    clearErrorBreakpoint: function(compilationUnit, line)
    {
    },

    clearAllBreakpoints: function(context)
    {
    },

    enableAllBreakpoints: function(context)
    {
    },

    disableAllBreakpoints: function(context)
    {
    },

    getBreakpointCount: function(context)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Tracing (see issue 6220)

    traceAll: function(context)
    {
    },

    untraceAll: function(context)
    {
    },

    traceCalls: function(context, fn)
    {
    },

    untraceCalls: function(context, fn)
    {
    },

    traceScriptCalls: function(context, script)
    {
    },

    untraceScriptCalls: function(context, script)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Debugging

    rerun: function(context)
    {
        context.getTool("debugger").rerun();
    },

    resume: function(context)
    {
        context.getTool("debugger").resume();
    },

    abort: function(context)
    {
    },

    stepOver: function(context)
    {
        context.getTool("debugger").stepOver();
    },

    stepInto: function(context)
    {
        context.getTool("debugger").stepInto();
    },

    stepOut: function(context)
    {
        context.getTool("debugger").stepOut();
    },

    suspend: function(context)
    {
    },

    unSuspend: function(context)
    {
    },

    runUntil: function(context, compilationUnit, lineNo)
    {
        context.getTool("debugger").runUntil(compilationUnit, lineNo);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    freeze: function(context)
    {
    },

    suppressEventHandling: function(context)
    {
    },

    thaw: function(context)
    {
    },

    unsuppressEventHandling: function(context)
    {
    },

    toggleFreezeWindow: function(context)
    {
    },

    doToggleFreezeWindow: function(context)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    halt: function(fnOfFrame)
    {
    },

    breakAsIfDebugger: function(frame)
    {
        // Used by FBTest
    },

    breakNow: function(context)
    {
        DebuggerHalter.breakNow(context);
    },

    stop: function(context, frame, type, rv)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Evaluation

    // xxxHonza: this entire methods should share API with the CommandLine if possible.
    evaluate: function(js, context, scope)
    {
        Trace.sysout("debugger.evaluate; " + js, scope);

        var currentFrame = context.currentFrame;
        if (!currentFrame)
            return;

        var threadActor = DebuggerLib.getThreadActor(context.browser);
        var frameActor = currentFrame.getActor();
        var frame = threadActor._requestFrame(frameActor);

        try
        {
            var result;

            var dbgGlobal = DebuggerLib.getDebuggeeGlobal(context);
            scope = dbgGlobal.makeDebuggeeValue(scope);

            if (scope)
                result = frame.evalWithBindings(js, scope);
            else
                result = frame.eval(js);

            Trace.sysout("debugger.evaluate; RESULT:", result);

            if (result.hasOwnProperty("return"))
            {
                result = result["return"];

                if (typeof(result) == "object")
                    return DebuggerLib.unwrapDebuggeeValue(result);
                else
                    return result;
            }
        }
        catch (e)
        {
            TraceError.sysout("debugger.evaluate; EXCEPTION " + e, e);
        }
    },

    evaluateInCallingFrame: function(js, fileName, lineNo)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    getCurrentStackTrace: function(context)
    {
        return DebuggerHalter.getCurrentStackTrace(context);
    },

    hasValidStack: function(context)
    {
        return context.stopped;
    },

    getCurrentFrameKeys: function(context)
    {
        var frame = context.stoppedFrame;
        var ret = [];
        for (var scope of frame.scopes)
        {
            // "this" is not a real scope.
            if (scope.name === "this")
                continue;

            // We can't synchronously read properties of objects on the scope chain,
            // so always ignore them to avoid inconsistencies. They are pretty uncommon
            // anyway (apart from the global object, which gets special treatment).
            var type = scope.grip.type;
            if (type === "object" || type === "with")
                continue;

            var props = scope.getProperties();
            if (!props || !Array.isArray(props))
                continue;

            for (var prop of props)
                ret.push(prop.name);
        }
        return ret;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Private to Debugger

    beginInternalOperation: function() // stop debugger operations like breakOnErrors
    {
    },

    endInternalOperation: function(state)  // pass back the object given by beginInternalOperation
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Menu in toolbar.

    onScriptFilterMenuTooltipShowing: function(tooltip, context)
    {
        Trace.sysout("onScriptFilterMenuTooltipShowing not implemented");
    },

    onScriptFilterMenuCommand: function(event, context)
    {
        var menu = event.target;
        Options.set("scriptsFilter", menu.value);
        Firebug.Debugger.filterMenuUpdate();
    },

    menuFullLabel:
    {
        "static": Locale.$STR("ScriptsFilterStatic"),
        evals: Locale.$STR("ScriptsFilterEval"),
        events: Locale.$STR("ScriptsFilterEvent"),
        all: Locale.$STR("ScriptsFilterAll"),
    },

    menuShortLabel:
    {
        "static": Locale.$STR("ScriptsFilterStaticShort"),
        evals: Locale.$STR("ScriptsFilterEvalShort"),
        events: Locale.$STR("ScriptsFilterEventShort"),
        all: Locale.$STR("ScriptsFilterAllShort"),
    },

    onScriptFilterMenuPopupShowing: function(menu, context)
    {
        if (this.menuTooltip)
            this.menuTooltip.fbEnabled = false;

        var items = menu.getElementsByTagName("menuitem");
        var value = this.filterButton.value;

        for (var i=0; i<items.length; i++)
        {
            var option = items[i].value;
            if (!option)
                continue;

            if (option == value)
                items[i].setAttribute("checked", "true");

            items[i].label = Firebug.Debugger.menuFullLabel[option];
        }

        return true;
    },

    onScriptFilterMenuPopupHiding: function(tooltip, context)
    {
        if (this.menuTooltip)
            this.menuTooltip.fbEnabled = true;

        return true;
    },

    filterMenuUpdate: function()
    {
        var value = Options.get("scriptsFilter");

        this.filterButton.value = value;
        this.filterButton.label = this.menuShortLabel[value];
        this.filterButton.removeAttribute("disabled");
        this.filterButton.setAttribute("value", value);

        Trace.sysout("debugger.filterMenuUpdate value: " + value + " label: " +
            this.filterButton.label);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // BTI

    toolName: "script",

    // xxxHonza: events are dispatched to connection (BTI.Browser) listeners
    // It's e.g. "getBreakpoints" at this moment.
    addListener: function(listener)
    {
        Firebug.connection.addListener(listener);
    },

    removeListener: function(listener)
    {
        Firebug.connection.removeListener(listener);
    },
});

// ********************************************************************************************* //
// Registration

Firebug.registerActivableModule(Firebug.Debugger);

return Firebug.Debugger;

// ********************************************************************************************* //
});
