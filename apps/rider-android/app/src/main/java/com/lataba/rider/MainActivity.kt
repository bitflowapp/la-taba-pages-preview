package com.lataba.rider

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.*

class MainActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { RiderApp() } } }
    }
}
@Composable fun RiderApp(vm: RiderViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val gpsPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true)
            context.startForegroundService(Intent(context, RiderLocationService::class.java))
    }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState())) {
        Text("La Taba · Rider QA", style = MaterialTheme.typography.headlineSmall)
        Text("STAGING · Nueva implementación nativa", style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(16.dp))
        if (!state.signedIn) {
            OutlinedTextField(email, { email = it }, label = { Text("Email Rider") }, modifier = Modifier.fillMaxWidth().testTag("email"), singleLine = true)
            OutlinedTextField(password, { password = it }, label = { Text("Contraseña") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("password"), singleLine = true)
            Button(onClick = { vm.login(email.trim(), password); password = "" }, enabled = !state.busy && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.testTag("login")) { Text("Ingresar") }
        } else {
            Row { Text(if (state.online) "Conectado" else "Sin conexión · datos anteriores", Modifier.weight(1f)); TextButton(onClick = { context.stopService(Intent(context, RiderLocationService::class.java)); vm.logout() }) { Text("Salir") } }
            Row { Text(if (state.available) "Disponible" else "No disponible", Modifier.weight(1f)); Switch(state.available, { vm.available(it) }, modifier = Modifier.testTag("available")) }
            Text("Disponibilidad local: pausa la aceptación; no cambia presencia del servidor.", style = MaterialTheme.typography.labelSmall)
            TextButton(onClick = vm::refresh, modifier = Modifier.testTag("refresh")) { Text("Actualizar") }
            Text(state.gps, modifier = Modifier.testTag("gps-status"))
            if (state.board?.orders?.any { it.publishable } == true) {
                Button(onClick = {
                    gpsPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION) +
                        if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray())
                }, modifier = Modifier.testTag("gps-start")) { Text("Activar GPS real") }
            }
            // A single outer scroll owns both header and content, including landscape screens.
            NavHost(nav, "board", modifier = Modifier.fillMaxWidth().wrapContentHeight()) {
                composable("board") {
                    Column {
                        val board = state.board
                        Text("Tus entregas ${board?.orders?.size ?: "—"}/${board?.capacity ?: "—"}", style = MaterialTheme.typography.titleLarge)
                        board?.orders?.forEach { order ->
                            Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) {
                                Text(order.code); Text(order.status)
                                Button(onClick = { nav.navigate("delivery/${order.id}") }, modifier = Modifier.testTag("detail-${order.code}")) { Text("Ver entrega") }
                            } }
                        }
                        Text("Solicitudes del negocio", style = MaterialTheme.typography.titleMedium)
                        if (board?.offers?.isEmpty() == true) Text("Sin solicitudes pendientes")
                        board?.offers?.forEach { offer ->
                            Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) {
                                Text(offer.code); Text("Retiro: ${offer.pickup}"); Text("Zona: ${offer.zone}")
                                Row {
                                    Button(onClick = { vm.offer(offer, true) }, enabled = !state.busy && state.online && state.available && !board.atCapacity, modifier = Modifier.testTag("accept-${offer.code}")) { Text("Aceptar") }
                                    TextButton(onClick = { vm.offer(offer, false) }, enabled = !state.busy && state.online) { Text("Rechazar") }
                                }
                            } }
                        }
                    }
                }
                composable("delivery/{id}") { entry ->
                    val order = state.board?.orders?.find { it.id == entry.arguments?.getString("id") }
                    var code by remember(entry.arguments?.getString("id")) { mutableStateOf("") }
                    Column {
                        TextButton(onClick = { nav.popBackStack() }) { Text("Volver a entregas") }
                        if (order == null) Text("La entrega ya no está activa. Actualizá para confirmar su estado.")
                        else {
                            Text(order.code, style = MaterialTheme.typography.titleLarge)
                            Text("Estado: ${order.status}"); Text("Retiro: ${order.pickup}"); Text("Destino: ${order.address}"); Text("Total: ${order.total}")
                            TextButton(onClick = {
                                val target = if (order.status == "assigned") order.pickup else order.address
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(target)}"))) }
                            }) { Text("Abrir navegación") }
                            if (order.status == "arrived") OutlinedTextField(code, { code = it.filter(Char::isDigit).take(RiderCommands.CODE_LENGTH) }, label = { Text("Código del cliente") }, modifier = Modifier.testTag("delivery-code"), singleLine = true)
                            val action = RiderCommands.next(order.status)
                            if (action != null) Button(onClick = { vm.advance(order, code); code = "" }, enabled = !state.busy && state.online && (order.status != "arrived" || RiderCommands.validCode(code)), modifier = Modifier.testTag("advance")) {
                                Text(when(order.status) { "assigned" -> "Confirmar retiro"; "picked_up" -> "Iniciar reparto"; "on_the_way" -> "Llegué al destino"; else -> "Confirmar código y finalizar" })
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(state.message, modifier = Modifier.testTag("status"))
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
