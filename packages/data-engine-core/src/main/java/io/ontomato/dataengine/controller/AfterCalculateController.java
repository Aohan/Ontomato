package io.ontomato.dataengine.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import io.ontomato.dataengine.service.AfterCalculateService;

@RestController
public class AfterCalculateController {
	
	@Autowired
    private AfterCalculateService afterCalculateService;

	@GetMapping("/afterCalculate/cache/{fileName}")
	public ResponseEntity<Resource> download(@PathVariable String fileName) {
		Resource resource = new FileSystemResource(afterCalculateService.getSubQueryCacheFile(fileName));
		if (resource.exists() && resource.isReadable()) {
            return ResponseEntity.ok()
                    .body(resource);
        } else {
            return ResponseEntity.notFound().build();
        }
	}
	
}
