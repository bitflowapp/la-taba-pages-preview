package com.lataba.rider

import android.app.Application

class RiderApplication: Application() {
    val repository by lazy { RiderRepository(RiderApi(SessionVault(this))) }
}
