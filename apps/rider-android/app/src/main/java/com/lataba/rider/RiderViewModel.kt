package com.lataba.rider

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class RiderViewModel(app: Application): AndroidViewModel(app) {
    private val repository = (app as RiderApplication).repository
    val state = repository.state
    init { viewModelScope.launch { while (true) { repository.refresh(); delay(5000) } } }
    fun login(email: String, password: String) { viewModelScope.launch { repository.login(email, password) } }
    fun refresh() { viewModelScope.launch { repository.refresh() } }
    fun logout() { viewModelScope.launch { repository.logout() } }
    fun available(value: Boolean) { viewModelScope.launch { repository.availability(value) } }
    fun offer(offer: Offer, accept: Boolean) { viewModelScope.launch { repository.offer(offer, accept) } }
    fun advance(order: Delivery, code: String = "") { viewModelScope.launch { repository.advance(order, code) } }
}
