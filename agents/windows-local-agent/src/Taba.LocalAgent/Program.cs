using Taba.LocalAgent.Cli;

// Servicio de Windows «TabaLocalAgent»: impresión y hardware del mostrador.
// Sin argumentos (o «service») corre el servicio; el resto son comandos de
// instalación y diagnóstico (ver «TabaLocalAgent help»).
return await AgentCli.RunAsync(args).ConfigureAwait(false);
