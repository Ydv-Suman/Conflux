package com.conflux.collaborationservice;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "app.document-directory=${java.io.tmpdir}/conflux-context-${random.uuid}")
class CollaborationServiceApplicationTests {

	@Test
	void contextLoads() {
	}

}
