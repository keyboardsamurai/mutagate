package com.example.matrix;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class MatrixApplication {

    public static void main(String[] args) {
        SpringApplication.run(MatrixApplication.class, args);
    }

    @Bean
    MatrixService matrixService(@Value("${matrix.size:3x3}") String size, @Value("${matrix.fill:0}") int fill) {
        String[] parts = size.trim().toLowerCase().split("x");
        if (parts.length != 2) {
            throw new IllegalArgumentException("matrix.size must look like <rows>x<cols>, got " + size);
        }
        MatrixService service = new MatrixService(Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim()));
        for (int r = 0; r < service.rows(); r++) {
            for (int c = 0; c < service.cols(); c++) {
                service.set(r, c, fill);
            }
        }
        return service;
    }
}
