using Taba.LocalAgent;

// Servicio de Windows «TabaLocalAgent»: impresión y hardware del mostrador.
// Escucha sólo en 127.0.0.1; la configuración está en appsettings.json.
var app = LocalAgentHost.Build(args);
await app.RunAsync().ConfigureAwait(false);
