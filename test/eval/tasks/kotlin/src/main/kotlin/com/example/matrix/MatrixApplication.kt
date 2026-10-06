package com.example.matrix

import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean

@SpringBootApplication
class MatrixApplication {

    @Bean
    fun matrixService(@Value("\${matrix.size:3x3}") size: String, @Value("\${matrix.fill:0}") fill: Int): MatrixService {
        val (rows, cols) = parseSize(size)
        val service = MatrixService(rows, cols)
        for (r in 0 until service.rows) {
            for (c in 0 until service.cols) {
                service.set(r, c, fill)
            }
        }
        return service
    }
}

fun parseSize(size: String): Pair<Int, Int> {
    val parts = size.trim().lowercase().split("x")
    if (parts.size != 2) {
        throw IllegalArgumentException("matrix.size must look like <rows>x<cols>, got $size")
    }
    return parts[0].trim().toInt() to parts[1].trim().toInt()
}

fun main(args: Array<String>) {
    runApplication<MatrixApplication>(*args)
}
